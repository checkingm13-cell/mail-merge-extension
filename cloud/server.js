/**
 * cloud/server.js
 * 24/7 Mail Merge Cloud Runner - Web Dashboard & Management Server
 *
 * Lightweight, zero-dependency Node.js HTTP server.
 * Serves the Web Dashboard and exposes REST API status endpoints for the Oracle Cloud VPS.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { exec } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const DASHBOARD_DIR = path.join(ROOT_DIR, 'src', 'dashboard');

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

/**
 * Checks Chrome process status via shell command
 */
function checkProcessRunning(processName) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `tasklist /FI "IMAGENAME eq ${processName}.exe"` : `pgrep -f "${processName}"`;
    exec(cmd, (err, stdout) => {
      if (err) return resolve(false);
      if (isWin) {
        resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
      } else {
        resolve(stdout.trim().length > 0);
      }
    });
  });
}

/**
 * Queries Chrome DevTools Protocol (CDP) on port 9222
 */
function queryCDP(endpoint) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:9222${endpoint}`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ ok: true, data: JSON.parse(data) });
        } catch (_) {
          resolve({ ok: true, raw: data });
        }
      });
    });
    req.on('error', () => resolve({ ok: false, error: 'CDP unreachable' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'CDP timeout' });
    });
  });
}

/**
 * Evaluates a JavaScript expression inside a Chrome target using WebSocket CDP
 */
function evaluateInTarget(wsUrl, expression) {
  return new Promise((resolve) => {
    if (typeof globalThis.WebSocket !== 'function') {
      return resolve({ ok: false, error: 'WebSocket not supported in this Node runtime' });
    }
    let ws;
    try {
      ws = new globalThis.WebSocket(wsUrl);
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      resolve({ ok: false, error: 'CDP evaluate timeout (4s)' });
    }, 4000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: Math.floor(Math.random() * 100000),
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    };
    ws.onmessage = (evt) => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(evt.data);
        try { ws.close(); } catch (_) {}
        if (res.result && res.result.result) {
          resolve({ ok: true, value: res.result.result.value });
        } else {
          resolve({ ok: false, error: res.error || 'Evaluation failed' });
        }
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err?.message || 'CDP WebSocket error' });
    };
  });
}

/**
 * Finds the extension service worker or an open Gmail tab target
 */
async function getExtensionTarget() {
  const tabsRes = await queryCDP('/json');
  if (!tabsRes.ok || !Array.isArray(tabsRes.data)) return null;

  let target = tabsRes.data.find((t) => 
    t.webSocketDebuggerUrl && 
    (t.url.includes('chrome-extension://') || t.type === 'service_worker' || t.type === 'background_page')
  );
  if (!target) {
    target = tabsRes.data.find((t) => t.webSocketDebuggerUrl && t.url.includes('mail.google.com'));
  }
  return target;
}

/**
 * Sends remote push notifications to Telegram or Discord if configured
 */
async function sendWebhookAlert(title, message, isUrgent = false) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

  const emoji = isUrgent ? '🚨' : '📢';
  const fullText = `${emoji} *${title}*\n${message}\n_Host: ${os.hostname()} (${new Date().toLocaleTimeString()})_`;

  if (telegramBotToken && telegramChatId && typeof fetch === 'function') {
    try {
      await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: fullText, parse_mode: 'Markdown' })
      });
    } catch (e) {
      console.warn('[Alert] Telegram send error:', e.message);
    }
  }

  if (discordWebhookUrl && typeof fetch === 'function') {
    try {
      await fetch(discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `${emoji} **${title}**\n${message}` })
      });
    } catch (e) {
      console.warn('[Alert] Discord send error:', e.message);
    }
  }
}

/**
 * Parses JSON body from incoming HTTP request
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (_) {
        resolve({});
      }
    });
  });
}

/**
 * HTTP Server Instance
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // Set default CORS and security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // =========================================================================
  // REST API ENDPOINTS
  // =========================================================================

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  if (pathname === '/api/status') {
    const [chromeRunning, x11vncRunning, xvfbRunning, cdpStatus] = await Promise.all([
      checkProcessRunning('chrome').then((res) => (res ? true : checkProcessRunning('chromium'))),
      checkProcessRunning('x11vnc'),
      checkProcessRunning('Xvfb'),
      queryCDP('/json/version')
    ]);

    const statusPayload = {
      system: {
        platform: os.platform(),
        architecture: os.arch(),
        uptimeSeconds: Math.floor(os.uptime()),
        memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
        memoryFreeMb: Math.round(os.freemem() / 1024 / 1024),
        loadAverage: os.loadavg ? os.loadavg() : []
      },
      services: {
        chrome: chromeRunning,
        x11vnc: x11vncRunning,
        xvfb: xvfbRunning,
        cdp: cdpStatus.ok ? cdpStatus.data : { connected: false }
      },
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statusPayload, null, 2));
    return;
  }

  if (pathname === '/api/tabs') {
    const cdpTabs = await queryCDP('/json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cdpTabs, null, 2));
    return;
  }

  if (pathname === '/api/session-health') {
    const cdpTabs = await queryCDP('/json');
    if (!cdpTabs.ok || !Array.isArray(cdpTabs.data)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ alive: false, error: 'CDP unreachable' }));
      return;
    }
    const hasAuthRedirect = cdpTabs.data.some((t) => t.url && t.url.includes('accounts.google.com'));
    const hasGmailTab = cdpTabs.data.some((t) => t.url && t.url.includes('mail.google.com'));

    if (hasAuthRedirect) {
      await sendWebhookAlert('Gmail Authentication Required', 'Google 2FA session expired. Please connect via VNC (:5900) to re-authenticate.', true);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      alive: hasGmailTab && !hasAuthRedirect,
      needsAuth: hasAuthRedirect,
      gmailTabOpen: hasGmailTab,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (pathname === '/api/campaigns' && req.method === 'GET') {
    const target = await getExtensionTarget();
    if (!target) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    const evalRes = await evaluateInTarget(target.webSocketDebuggerUrl, `(async () => {
      if (typeof self !== 'undefined' && self.IDBStore) {
        return await self.IDBStore.getCampaigns();
      }
      return [];
    })()`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(evalRes.ok ? evalRes.value : []));
    return;
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    const target = await getExtensionTarget();
    if (!target) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    const evalRes = await evaluateInTarget(target.webSocketDebuggerUrl, `(async () => {
      if (typeof self !== 'undefined' && self.IDBStore) {
        return await self.IDBStore.getLogs(null, 100);
      }
      return [];
    })()`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(evalRes.ok ? evalRes.value : []));
    return;
  }

  if (pathname === '/api/trigger' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const campaignId = body.campaignId;
    const target = await getExtensionTarget();
    if (!target) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Extension target unavailable' }));
      return;
    }
    const evalRes = await evaluateInTarget(target.webSocketDebuggerUrl, `(async () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        return await chrome.runtime.sendMessage({ action: 'TRIGGER_DUE_CAMPAIGNS_NOW', campaignId: '${campaignId || ''}' });
      }
      return { success: false, error: 'chrome.runtime not accessible' };
    })()`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(evalRes));
    return;
  }

  if (pathname === '/api/notify' && req.method === 'POST') {
    const body = await readJsonBody(req);
    await sendWebhookAlert(body.title || 'Test Alert', body.message || 'Notification from Mail Merge VPS', !!body.isUrgent);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Notification dispatched' }));
    return;
  }

  if (pathname === '/api/open-gmail' && req.method === 'POST') {
    const result = await queryCDP('/json/new?https://mail.google.com/');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: result.ok, details: result }));
    return;
  }

  // =========================================================================
  // STATIC FILE SERVING
  // =========================================================================

  let relativeFile = pathname;
  if (relativeFile === '/' || relativeFile === '/dashboard' || relativeFile === '/dashboard/') {
    relativeFile = '/src/dashboard/dashboard.html';
  } else if (!relativeFile.startsWith('/src/') && !relativeFile.startsWith('/icons/')) {
    // Check if it exists under src/dashboard or src/
    if (fs.existsSync(path.join(DASHBOARD_DIR, relativeFile))) {
      relativeFile = '/src/dashboard' + relativeFile;
    } else if (fs.existsSync(path.join(ROOT_DIR, 'src', relativeFile))) {
      relativeFile = '/src' + relativeFile;
    }
  }

  const filePath = path.join(ROOT_DIR, relativeFile);

  // Prevent directory traversal attacks
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback: If root dashboard is requested
      if (pathname.includes('dashboard.html')) {
        const defaultDashboard = path.join(DASHBOARD_DIR, 'dashboard.html');
        if (fs.existsSync(defaultDashboard)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(defaultDashboard).pipe(res);
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================================');
  console.log(`🌐 Mail Merge Cloud Web Server running on port ${PORT}`);
  console.log(`   Local URL     : http://localhost:${PORT}`);
  console.log(`   Tailscale URL : http://100.96.100.52:${PORT} (or your VPS Tailscale IP)`);
  console.log(`   Static Root   : ${ROOT_DIR}`);
  console.log('========================================================');
});
