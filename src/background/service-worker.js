/**
 * Background Service Worker for Gmail Native Mail Merge & Scheduler
 * Manifest V3 Compliant
 */

// Load IDBStore library into the service worker scope
try {
  importScripts('../db/idb-store.js');
} catch (err) {
  try {
    importScripts('/src/db/idb-store.js');
  } catch (fallbackErr) {
    console.error('[ServiceWorker] Failed to load idb-store.js:', fallbackErr);
  }
}

const ALARM_NAME = 'POLL_CAMPAIGNS_ALARM';
const POLL_INTERVAL_MINUTES = 1;
const HEALTH_ALARM_NAME = 'HEALTH_MONITOR_ALARM';
const HEALTH_INTERVAL_MINUTES = 5;
const SESSION_REFRESH_ALARM_NAME = 'SESSION_REFRESH_ALARM';
const SESSION_REFRESH_INTERVAL_MINUTES = 15; // 15-minute gentle automated session ping
const HEARTBEAT_ALARM_NAME = 'INTERNAL_HEARTBEAT';
const HEARTBEAT_INTERVAL_MINUTES = 5;

// Universal Exponential Backoff configuration (per failure recovery strategy)
const RETRY_CONFIG = {
  maxRetries: 5,
  backoff: [1000, 5000, 15000, 60000, 300000] // 1s, 5s, 15s, 1m, 5m
};

// =============================================================================
// HYBRID PARALLEL ARCHITECTURE: Account-Level Locks & Concurrency Pool
// =============================================================================
const MAX_CONCURRENT_ACCOUNTS = 3; // Max parallel executing accounts (3x throughput)
const accountLocks = new Map();    // accountKey -> { campaignId, startedAt, timeoutId }
const accountTabRegistry = new Map(); // accountKey (email) -> tabId (for instant routing)
const ACTIVE_CAMPAIGN_TABS = new Map(); // campaignId -> { tabId, timeoutId }

function isAccountExecuting(accountKey) {
  if (!accountKey) return accountLocks.size >= MAX_CONCURRENT_ACCOUNTS;
  const lock = accountLocks.get(accountKey);
  if (!lock) return false;
  // Safety check: auto-release stale lock older than 6 minutes
  if (Date.now() - lock.startedAt > 6 * 60 * 1000) {
    console.warn(`[ServiceWorker] Stale lock detected for account "${accountKey}" (campaign ${lock.campaignId}). Releasing...`);
    if (lock.timeoutId) clearTimeout(lock.timeoutId);
    accountLocks.delete(accountKey);
    return false;
  }
  return true;
}

function isCampaignExecuting(accountKey) {
  return isAccountExecuting(accountKey);
}

// =============================================================================
// SYSTEM WAKE-LOCK (Overnight Execution Protection)
// =============================================================================
let isWakeLockActive = false;

async function syncSystemWakeLock() {
  if (!chrome.power || typeof chrome.power.requestKeepAwake !== 'function') return;

  try {
    if (!self.IDBStore) return;
    const allCampaigns = await self.IDBStore.getCampaigns().catch(() => []);
    const hasPending = allCampaigns.some((c) => c.status === 'QUEUED' || c.status === 'PROCESSING');

    if (hasPending && !isWakeLockActive) {
      chrome.power.requestKeepAwake('system');
      isWakeLockActive = true;
      console.log('[ServiceWorker] ⚡ System wake-lock ACQUIRED (CPU stays active for scheduled campaigns, display can sleep).');
    } else if (!hasPending && isWakeLockActive) {
      chrome.power.releaseKeepAwake();
      isWakeLockActive = false;
      console.log('[ServiceWorker] 💤 System wake-lock RELEASED (queue is idle).');
    }
  } catch (err) {
    console.warn('[ServiceWorker] Wake-lock sync note:', err);
  }
}

// =============================================================================
// LIFECYCLE & ALARM MANAGEMENT
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[ServiceWorker] Extension installed/updated. Reason: ${details.reason}`);
  await setupAllAlarms();
  await refreshBadge();
  await syncSystemWakeLock();
  await injectIntoExistingGmailTabs();
  await runHealthCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[ServiceWorker] Extension starting up.');
  await setupAllAlarms();
  await refreshBadge();
  await syncSystemWakeLock();
  await injectIntoExistingGmailTabs();
  await runHealthCheck();
  // Check campaigns immediately on browser wakeup / startup
  await checkAndExecuteDueCampaigns();
});

/**
 * Injects content scripts into all already-open Gmail tabs so the user does
 * not need to manually refresh (F5) their Gmail tabs when the extension is updated.
 */
async function injectIntoExistingGmailTabs() {
  if (!chrome.scripting || !chrome.tabs) return;

  try {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    console.log(`[ServiceWorker] Found ${tabs.length} existing Gmail tab(s) to auto-inject.`);

    for (const tab of tabs) {
      try {
        // Protect tab from Chrome Memory Saver / Sleeping Tabs
        await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});

        if (tab.discarded) {
          console.log(`[ServiceWorker] Pinned Gmail tab ${tab.id} was discarded. Hard reloading to restore...`);
          await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
          continue;
        }

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'src/db/idb-store.js',
            'src/content/gmail-automator.js',
            'src/content/content.js'
          ]
        });
        console.log(`[ServiceWorker] Successfully auto-injected content scripts into Gmail tab ${tab.id}`);
      } catch (tabErr) {
        console.warn(`[ServiceWorker] Could not auto-inject into tab ${tab.id}:`, tabErr.message);
      }
    }
  } catch (err) {
    console.warn('[ServiceWorker] Auto-injection query error:', err.message);
  }
}

/**
 * Creates all recurring alarms: 1-minute dispatch poll, 5-minute health check, 15-minute session ping, 5-minute heartbeat.
 */
async function setupAllAlarms() {
  try {
    // 1. 1-minute campaign dispatch poll
    const existingPoll = await chrome.alarms.get(ALARM_NAME);
    if (!existingPoll) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
      console.log(`[ServiceWorker] Periodic alarm "${ALARM_NAME}" created (${POLL_INTERVAL_MINUTES} min).`);
    }

    // 2. 5-minute Health Monitoring alarm
    const existingHealth = await chrome.alarms.get(HEALTH_ALARM_NAME);
    if (!existingHealth) {
      chrome.alarms.create(HEALTH_ALARM_NAME, { periodInMinutes: HEALTH_INTERVAL_MINUTES });
      console.log(`[ServiceWorker] Health monitor alarm "${HEALTH_ALARM_NAME}" created (${HEALTH_INTERVAL_MINUTES} min).`);
    }

    // 3. 15-minute Google Session Refresh & automated ping alarm
    const existingSession = await chrome.alarms.get(SESSION_REFRESH_ALARM_NAME);
    if (!existingSession) {
      chrome.alarms.create(SESSION_REFRESH_ALARM_NAME, { periodInMinutes: SESSION_REFRESH_INTERVAL_MINUTES });
      console.log(`[ServiceWorker] Session refresh alarm "${SESSION_REFRESH_ALARM_NAME}" created (${SESSION_REFRESH_INTERVAL_MINUTES} min).`);
    }

    // 4. 5-minute Internal Heartbeat Monitor alarm
    const existingHeartbeat = await chrome.alarms.get(HEARTBEAT_ALARM_NAME);
    if (!existingHeartbeat) {
      chrome.alarms.create(HEARTBEAT_ALARM_NAME, { periodInMinutes: HEARTBEAT_INTERVAL_MINUTES });
      console.log(`[ServiceWorker] Heartbeat alarm "${HEARTBEAT_ALARM_NAME}" created (${HEARTBEAT_INTERVAL_MINUTES} min).`);
    }
  } catch (err) {
    console.error('[ServiceWorker] Error creating alarms:', err);
  }
}

// Immediate top-level initialization
setupAllAlarms().catch(() => {});
refreshBadge().catch(() => {});
injectIntoExistingGmailTabs().catch(() => {});

// Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log("[ServiceWorker] Alarm triggered: " + alarm.name);

  if (alarm.name === HEALTH_ALARM_NAME) {
    await runHealthCheck();
    return;
  }

  if (alarm.name === SESSION_REFRESH_ALARM_NAME) {
    await refreshGmailSessions();
    return;
  }

  if (alarm.name === HEARTBEAT_ALARM_NAME) {
    try {
      const now = Date.now();
      // 1. Check for stuck locks (older than 10 minutes)
      for (const [accountKey, lock] of accountLocks.entries()) {
        if (now - lock.startedAt > 10 * 60 * 1000) {
          console.warn(`[Heartbeat] 🚨 Detected stuck lock for "${accountKey}". Force releasing.`);
          await releaseAccountLock(accountKey, lock.campaignId);
        }
      }

      // 2. Verify Scheduler Alarm is still alive
      const pollAlarm = await chrome.alarms.get(ALARM_NAME);
      if (!pollAlarm) {
        console.warn('[Heartbeat] 🚨 Polling alarm missing! Recreating...');
        await setupAllAlarms();
      }

      // 3. Refresh Badge to prove SW is alive
      await refreshBadge();
      console.log('[Heartbeat] 💓 Internal heartbeat OK. System healthy. Active locks: ' + accountLocks.size);
    } catch (err) {
      console.error('[Heartbeat] ❌ Heartbeat check failed:', err);
      try {
        if (self.IDBStore) await self.IDBStore.init();
      } catch (_) {}
    }
    return;
  }

  if (alarm.name.startsWith("CAMPAIGN_")) {
    const campaignId = alarm.name.replace("CAMPAIGN_", "");
    if (self.IDBStore) {
      const campaign = await self.IDBStore.getCampaignById(campaignId);
      if (campaign && (campaign.status === "QUEUED" || campaign.status === "DRAFT")) {
        await executeCampaign(campaign);
        return;
      }
    }
  }

  console.log(`[ServiceWorker] Alarm triggered: "${alarm.name}". Checking due campaigns...`);
  await checkAndExecuteDueCampaigns();
});

/**
 * 5-Minute Health Monitoring System (per roadmap specification)
 * Checks:
 * - Service Worker alive & storage healthy
 * - Internet connected (navigator.onLine)
 * - Gmail tab(s) open & protected from Chrome Memory Saver
 * - Session valid (not redirected to accounts.google.com / "Verify it's you")
 */
async function runHealthCheck() {
  const status = {
    timestamp: new Date().toISOString(),
    swAlive: true,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    gmailTabsOpen: 0,
    sessionValid: true,
    details: []
  };

  try {
    // 1. Storage check
    if (self.IDBStore) {
      await self.IDBStore.init().catch(() => {});
    }

    // 2. Internet connectivity
    if (!status.online) {
      status.details.push('Internet connection offline.');
      console.warn('[HealthCheck] 🌐 Internet connection is offline.');
    }

    // 3. Gmail tab discovery & memory saver protection
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    status.gmailTabsOpen = tabs ? tabs.length : 0;

    if (tabs && tabs.length > 0) {
      for (const tab of tabs) {
        // Protect tab from memory saver discard
        await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});

        if (tab.discarded) {
          console.log(`[HealthCheck] Pinned tab ${tab.id} was discarded. Auto-recovering...`);
          await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
        }

        // Ping tab for session validation & "Verify it's you" detection
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_SESSION_HEALTH' }).catch(() => null);
          if (resp && resp.needsAuth) {
            status.sessionValid = false;
            status.details.push(`Tab ${tab.id} requires authentication ("Verify it's you").`);
          }
        } catch (_) {}
      }
    } else {
      status.details.push('No active Gmail tabs open.');
    }

    // 4. Record health in IDBStore settings
    if (self.IDBStore) {
      await self.IDBStore.setSetting('lastHealthCheck', status).catch(() => {});
    }

    console.log(`[HealthCheck] 🩺 Health check complete: online=${status.online}, gmailTabs=${status.gmailTabsOpen}, sessionValid=${status.sessionValid}`);
  } catch (err) {
    console.error('[HealthCheck] Error during health check:', err);
  }
}

/**
 * 15-Minute Automated Google Session Pinging Routine (per Devil & Ponytail decision)
 * - Verifies open Gmail tabs are active
 * - Auto-restores discarded tabs (Memory Saver bypassCache)
 * - Pings lightweight atom feed in tab context to maintain active session
 * - Alerts user if redirected to accounts.google.com ("Verify it's you")
 * - If no tab is open, waits until one is opened rather than spawning unwanted tabs
 */
async function refreshGmailSessions() {
  console.log('[SessionRefresh] 🔄 Running 15-minute Google Session Refresh & automated ping check...');
  try {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    if (!tabs || tabs.length === 0) {
      console.log('[SessionRefresh] ℹ️ No open Gmail tabs to ping. Waiting until user opens a tab.');
      return;
    }

    let healthyTabsCount = 0;

    for (const tab of tabs) {
      // Protect from Memory Saver
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});

      // 1. If tab was discarded, hard reload with bypassCache
      if (tab.discarded) {
        console.log(`[SessionRefresh] Restoring discarded Gmail tab ${tab.id}...`);
        await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
        await waitForTabComplete(tab.id, 25000);
      }

      // 2. Check if URL was redirected to accounts.google.com (auth prompt)
      if (tab.url && tab.url.includes('accounts.google.com')) {
        console.warn(`[SessionRefresh] ⚠️ Tab ${tab.id} was redirected to Google login.`);
        notifyDesktop(
          '🔑 Gmail Login Required',
          'A background Gmail session requires you to sign in ("Verify it\'s you").',
          true
        );
        continue;
      }

      // 3. Keep tab alive by sending a session heartbeat / feed ping
      try {
        const pingResp = await chrome.tabs.sendMessage(tab.id, { action: 'PING_GMAIL_SESSION' });
        if (pingResp && pingResp.needsAuth) {
          notifyDesktop(
            '🔑 Gmail Login Required',
            'Gmail session requires you to re-authenticate ("Verify it\'s you").',
            true
          );
        } else if (pingResp && pingResp.alive) {
          healthyTabsCount++;
        }
      } catch (_) {
        if (chrome.scripting) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/db/idb-store.js', 'src/content/gmail-automator.js', 'src/content/content.js']
          }).catch(() => {});
        }
      }
    }

    if (self.IDBStore) {
      await self.IDBStore.addLog(null, 'INFO', `Automated session ping verified ${healthyTabsCount}/${tabs.length} open Gmail tab(s).`).catch(() => {});
    }
  } catch (err) {
    console.error('[SessionRefresh] Error during session refresh:', err);
  }
}

// =============================================================================
// CAMPAIGN EXECUTION & GMAIL TAB COMMUNICATION
// =============================================================================

/**
 * Checks for due campaigns and executes them using the Hybrid Parallel Architecture.
 * Capped by MAX_CONCURRENT_ACCOUNTS (up to 3 parallel accounts), strictly sequential per account.
 */
async function checkAndExecuteDueCampaigns() {
  try {
    if (!self.IDBStore) {
      console.error('[ServiceWorker] IDBStore is not available.');
      return;
    }

    const dueCampaigns = await self.IDBStore.getDueCampaigns();
    if (!dueCampaigns || dueCampaigns.length === 0) {
      await refreshBadge();
      return;
    }

    // Filter out campaigns that are artificially postponed (e.g., missed offline, quota)
    const readyCampaigns = dueCampaigns.filter((c) => c.status === 'QUEUED');
    if (readyCampaigns.length === 0) {
      await refreshBadge();
      return;
    }

    // Check overdue campaigns and detect missed offline dispatches
    const now = Date.now();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const MISSED_OFFLINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes overdue while browser/PC was off
    const activeReadyCampaigns = [];

    for (const camp of readyCampaigns) {
      if (camp.scheduledAt) {
        const schedTime = new Date(camp.scheduledAt).getTime();
        const overdueMs = now - schedTime;

        if (overdueMs > MISSED_OFFLINE_THRESHOLD_MS) {
          const overdueMinutes = Math.round(overdueMs / 60000);
          console.warn(`[ServiceWorker] ⏰ Campaign ${camp.id} missed scheduled dispatch by ${overdueMinutes}m while offline. Marking FAILED.`);
          await self.IDBStore.updateCampaign(camp.id, {
            status: 'FAILED',
            errorCategory: 'SCHEDULE_MISSED_OFFLINE',
            errorMessage: `Scheduled dispatch time (${new Date(schedTime).toLocaleTimeString()}) passed while PC or Chrome was offline (${overdueMinutes}m overdue). Click "♻️ Clone" or "↻ Retry" to dispatch.`,
            failedAt: new Date().toISOString(),
            canAutoRetry: true
          });
          await self.IDBStore.addLog(
            camp.id,
            'WARN',
            `Campaign marked FAILED: Scheduled time passed while browser was offline (${overdueMinutes}m ago). Zero surprise emails dispatched.`
          );
          continue;
        } else if (overdueMs > FIVE_MINUTES_MS) {
          const overdueMinutes = Math.round(overdueMs / 60000);
          await self.IDBStore.addLog(
            camp.id,
            'INFO',
            `Executing overdue campaign (scheduled for ${new Date(schedTime).toLocaleTimeString()}, ${overdueMinutes}m late).`
          ).catch(() => {});
        }
      }
      activeReadyCampaigns.push(camp);
    }

    if (activeReadyCampaigns.length === 0) {
      await refreshBadge();
      return;
    }

    // Group ready campaigns by account
    const accountGroups = {};
    for (const campaign of activeReadyCampaigns) {
      const key = (campaign.accountEmail || '').toLowerCase().trim() || String(campaign.userIndex !== undefined ? campaign.userIndex : '0');
      if (!accountGroups[key]) accountGroups[key] = [];
      accountGroups[key].push(campaign);
    }

    // Sort each account's queue strictly by scheduled time / created time (FIFO)
    for (const key in accountGroups) {
      accountGroups[key].sort((a, b) => new Date(a.scheduledAt || a.createdAt || 0) - new Date(b.scheduledAt || b.createdAt || 0));
    }

    // Count currently executing accounts
    const currentlyExecutingCount = accountLocks.size;
    const availableSlots = MAX_CONCURRENT_ACCOUNTS - currentlyExecutingCount;

    if (availableSlots <= 0) {
      console.log(`[ServiceWorker] ⏳ Concurrency limit reached (${accountLocks.size}/${MAX_CONCURRENT_ACCOUNTS}). Queuing remaining campaigns.`);
      await refreshBadge();
      return;
    }

    // Dispatch to available slots across accounts
    let dispatchedCount = 0;
    for (const accountKey in accountGroups) {
      if (dispatchedCount >= availableSlots) break;

      // Check if this specific account is already locked
      if (accountLocks.has(accountKey)) {
        console.log(`[ServiceWorker] ⏳ Account "${accountKey}" is currently executing. Skipping to next account.`);
        continue;
      }

      const nextCampaign = accountGroups[accountKey][0];
      console.log(`[ServiceWorker] 🚀 Dispatching campaign ${nextCampaign.id} for account "${accountKey}" (Slot ${currentlyExecutingCount + dispatchedCount + 1}/${MAX_CONCURRENT_ACCOUNTS})`);

      executeCampaign(nextCampaign).catch((err) => {
        console.error(`[ServiceWorker] Execution error for ${nextCampaign.id}:`, err);
      });

      dispatchedCount++;
    }

    await refreshBadge();
    await syncSystemWakeLock();
  } catch (err) {
    console.error('[ServiceWorker] Error checking due campaigns:', err);
    if (self.IDBStore) {
      await self.IDBStore.addLog(null, 'ERROR', `Scheduler check failed: ${err.message}`).catch(() => {});
    }
  }
}

/**
 * Finds or opens a Gmail tab and transmits the EXECUTE_CAMPAIGN action using Account-Level Locks.
 * @param {Object} campaign
 */
async function executeCampaign(campaign) {
  const accountKey = (campaign.accountEmail || '').toLowerCase().trim() || String(campaign.userIndex !== undefined ? campaign.userIndex : '0');

  // 0. UNBREAKABLE SCHEDULING GUARD: Reject execution if scheduled time is in the future
  if (campaign.scheduledAt) {
    const scheduledTime = new Date(campaign.scheduledAt).getTime();
    if (!isNaN(scheduledTime) && scheduledTime > Date.now() + 5000) {
      console.warn(`[ServiceWorker] 🛡️ Blocked premature execution of campaign ${campaign.id}. Scheduled for ${campaign.scheduledAt}, current time is ${new Date().toISOString()}`);
      chrome.alarms.create(`CAMPAIGN_${campaign.id}`, { when: scheduledTime });
      return;
    }
  }

  // 1. ACQUIRE ACCOUNT LOCK
  if (accountLocks.has(accountKey)) {
    console.log(`[ServiceWorker] ⏳ Account "${accountKey}" is currently executing. Campaign "${campaign.id}" remains QUEUED.`);
    return;
  }

  // Pre-execution network connectivity check
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const retryCount = (campaign.networkRetryCount || 0) + 1;
    if (retryCount <= 5) {
      const postponeTime = Date.now() + 3 * 60 * 1000;
      console.warn(`[ServiceWorker] 🌐 Internet offline. Postponing campaign ${campaign.id} by 3 minutes (attempt ${retryCount}/5).`);
      await self.IDBStore.updateCampaign(campaign.id, {
        status: 'QUEUED',
        scheduledAt: new Date(postponeTime).toISOString(),
        networkRetryCount: retryCount
      });
      await self.IDBStore.addLog(
        campaign.id,
        'WARN',
        `Internet connection is offline. Campaign postponed by 3 minutes (retry attempt ${retryCount}/5).`
      );
      chrome.alarms.create(`CAMPAIGN_${campaign.id}`, { when: postponeTime });
      return;
    } else {
      throw new Error('Network Offline: Internet connection was unavailable after 5 retry attempts.');
    }
  }

  // Set the account lock with a 6-minute safety timeout
  const timeoutId = setTimeout(() => {
    console.warn(`[ServiceWorker] ⚠️ Safety timeout (6 min) reached for account ${accountKey}. Releasing lock.`);
    releaseAccountLock(accountKey, campaign.id).catch(() => {});
  }, 6 * 60 * 1000);

  accountLocks.set(accountKey, {
    campaignId: campaign.id,
    startedAt: Date.now(),
    timeoutId
  });

  let createdBackgroundTabId = null;

  try {
    // 1. Check if user is actively editing this exact draft in any open Gmail tab
    try {
      const openTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
      for (const tab of openTabs) {
        const status = await chrome.tabs.sendMessage(tab.id, {
          action: 'CHECK_IS_USER_EDITING_DRAFT',
          draftId: campaign.draftId,
          subject: campaign.subject
        }).catch(() => null);

        if (status && status.isEditing) {
          console.log(`[ServiceWorker] ⏸️ User is actively typing in draft for campaign ${campaign.id}. Postponing by 5 minutes.`);
          const postponedTime = Date.now() + 5 * 60 * 1000;
          await self.IDBStore.updateCampaign(campaign.id, {
            status: 'QUEUED',
            scheduledAt: new Date(postponedTime).toISOString()
          });
          await self.IDBStore.addLog(
            campaign.id,
            'INFO',
            `Campaign postponed by 5 minutes because user was actively editing this draft in Gmail.`
          );
          chrome.alarms.create(`CAMPAIGN_${campaign.id}`, { when: postponedTime });
          notifyDesktop(
            '⏳ Mail Merge Postponed',
            `"${campaign.subject || 'Campaign'}" was postponed by 5 minutes because you are actively editing it.`
          );
          await releaseAccountLock(accountKey, campaign.id);
          await refreshBadge();
          return;
        }
      }
    } catch (activeErr) {
      console.warn('[ServiceWorker] Note on checking active draft editing:', activeErr.message);
    }

    // 2. Update status to PROCESSING immediately
    await self.IDBStore.updateCampaign(campaign.id, {
      status: 'PROCESSING',
      startedAt: new Date().toISOString()
    });

    await self.IDBStore.addLog(
      campaign.id,
      'INFO',
      `Scheduler initiated campaign "${campaign.name || campaign.subject || campaign.id}" for account "${accountKey}".`
    );

    // 3. Prioritize reusing an existing open Gmail tab with Account Tab Registry
    let targetTab = await findGmailTab(campaign);

    if (!targetTab) {
      // Only open a new tab as fallback if no verified Gmail tab is open for this account
      const baseUrl = campaign.accountUrl || (campaign.userIndex !== undefined ? `https://mail.google.com/mail/u/${campaign.userIndex}/` : 'https://mail.google.com/mail/u/0/');
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');
      const targetUrl = (campaign.draftId && campaign.draftId !== 'unknown')
        ? `${cleanBaseUrl}/#drafts?compose=${campaign.draftId}`
        : `${cleanBaseUrl}/#drafts`;

      console.log(`[ServiceWorker] 🛡️ Opening dedicated tab for campaign ${campaign.id} (${accountKey}): ${targetUrl}`);
      targetTab = await chrome.tabs.create({
        url: targetUrl,
        active: false // completely in background
      });
      createdBackgroundTabId = targetTab.id;

      await waitForTabComplete(targetTab.id, 25000);
      await delay(2000);

      // Check if user is logged out and tab redirected to accounts.google.com
      try {
        const currentTab = await chrome.tabs.get(targetTab.id);
        if (currentTab && currentTab.url && currentTab.url.includes('accounts.google.com')) {
          throw new Error('Google account login required (redirected to accounts.google.com). Please sign in to Gmail.');
        }
      } catch (checkErr) {
        if (checkErr.message && checkErr.message.includes('Google account login required')) {
          throw checkErr;
        }
      }
    } else {
      console.log(`[ServiceWorker] ⚡ Reusing verified Gmail tab ${targetTab.id} for account "${accountKey}" (Campaign ${campaign.id})`);
    }

    // Register active tab for auto-cleanup
    if (createdBackgroundTabId) {
      ACTIVE_CAMPAIGN_TABS.set(campaign.id, {
        tabId: createdBackgroundTabId,
        timeoutId: setTimeout(() => {
          console.warn(`[ServiceWorker] Campaign ${campaign.id} safety timeout (5 min). Closing tab ${createdBackgroundTabId}.`);
          chrome.tabs.remove(createdBackgroundTabId).catch(() => {});
          ACTIVE_CAMPAIGN_TABS.delete(campaign.id);
        }, 5 * 60 * 1000)
      });
    }

    // Ensure window containing tab is not minimized
    try {
      if (targetTab && targetTab.windowId) {
        const win = await chrome.windows.get(targetTab.windowId);
        if (win && win.state === 'minimized') {
          console.log(`[ServiceWorker] 🪟 Restoring minimized Chrome window ${targetTab.windowId} to normal state for reliable automation...`);
          await chrome.windows.update(targetTab.windowId, { state: 'normal' });
          await delay(1000);
        }
      }
    } catch (winErr) {
      console.warn('[ServiceWorker] Note on window state check:', winErr.message);
    }

    // 4. Send message to content script in target tab and await handshake ACK
    const sent = await sendMessageWithRetry(targetTab.id, {
      action: 'EXECUTE_CAMPAIGN',
      campaign
    });

    if (sent) {
      console.log(`[ServiceWorker] Dispatched campaign ${campaign.id} to tab ${targetTab.id} (ACK received). Active accounts executing: ${accountLocks.size}/${MAX_CONCURRENT_ACCOUNTS}`);
    } else {
      throw new Error(`Failed to deliver EXECUTE_CAMPAIGN message to Gmail tab ${targetTab.id}`);
    }
  } catch (err) {
    console.error(`[ServiceWorker] Failed to execute campaign ${campaign.id}:`, err);

    if (createdBackgroundTabId) {
      setTimeout(() => {
        chrome.tabs.remove(createdBackgroundTabId).catch(() => {});
      }, 2000);
    }

    const isQuota = err.message && err.message.includes('Daily Sending Limit');
    const isDraftMissing = err.message && (err.message.includes('[DRAFT_NOT_FOUND]') || err.message.includes('Draft was deleted'));
    const isAuth = err.message && (err.message.includes('Google account login required') || err.message.includes('accounts.google.com'));
    const isFatal = isQuota || isDraftMissing || isAuth || (campaign.canAutoRetry === false);

    const retryCount = (campaign.autoRetryCount || 0) + 1;

    if (!isFatal && retryCount <= RETRY_CONFIG.maxRetries) {
      const delayMs = RETRY_CONFIG.backoff[retryCount - 1] || 60000;
      const nextTime = Date.now() + delayMs;
      console.warn(`[ServiceWorker] 🔁 Transient setup error for campaign ${campaign.id}. Auto-retrying in ${Math.round(delayMs / 1000)}s with exponential backoff (attempt ${retryCount}/${RETRY_CONFIG.maxRetries})...`);

      await self.IDBStore.updateCampaign(campaign.id, {
        status: 'QUEUED',
        scheduledAt: new Date(nextTime).toISOString(),
        autoRetryCount: retryCount,
        progressMessage: `Auto-recovering in ${Math.round(delayMs / 1000)}s (attempt ${retryCount}/${RETRY_CONFIG.maxRetries})...`
      });
      await self.IDBStore.addLog(
        campaign.id,
        'WARN',
        `Setup failed: ${err.message}. Automatically recovering in ${Math.round(delayMs / 1000)}s with exponential backoff (attempt ${retryCount}/${RETRY_CONFIG.maxRetries}).`
      );
      chrome.alarms.create(`CAMPAIGN_${campaign.id}`, { when: nextTime });
      await releaseAccountLock(accountKey, campaign.id);
      await refreshBadge();
      return;
    }

    await self.IDBStore.updateCampaign(campaign.id, {
      status: 'FAILED',
      errorMessage: err.message,
      canAutoRetry: !isDraftMissing && !isQuota,
      failedAt: new Date().toISOString()
    });
    await self.IDBStore.addLog(campaign.id, 'ERROR', `Execution trigger error: ${err.message}`);

    // If Daily Sending Limit was reached, pause remaining campaigns for 12 hours
    if (isQuota) {
      await pauseAccountCampaignsForQuota(campaign.accountEmail);
    }

    notifyDesktop(
      '❌ Mail Merge Error',
      `Failed to send "${campaign.subject || 'Campaign'}": ${err.message}`,
      true
    );

    // Free account lock on setup failure so subsequent campaigns for this account can run
    await releaseAccountLock(accountKey, campaign.id);
  }
}

/**
 * Releases the account execution lock and triggers the next queued campaign for this account.
 * Maintains the Concurrency Pool at peak efficiency.
 * @param {string} accountKey
 * @param {string} [campaignId]
 */
async function releaseAccountLock(accountKey, campaignId) {
  if (!accountKey) return;
  const lock = accountLocks.get(accountKey);

  if (lock && (!campaignId || lock.campaignId === campaignId)) {
    if (lock.timeoutId) clearTimeout(lock.timeoutId);
    accountLocks.delete(accountKey);
    console.log(`[ServiceWorker] 🔓 Released execution lock for account "${accountKey}". Active pool: ${accountLocks.size}/${MAX_CONCURRENT_ACCOUNTS}`);
  }

  // 3.5s buffer for Gmail tab to close and DOM to settle cleanly before next execution
  setTimeout(async () => {
    if (!self.IDBStore) return;

    try {
      // 1. Check if another campaign is already queued for this specific account
      if (!accountLocks.has(accountKey)) {
        const campaigns = await self.IDBStore.getCampaigns();
        const now = Date.now();
        const dueForAccount = campaigns
          .filter((c) => {
            if (c.status !== 'QUEUED') return false;
            const key = (c.accountEmail || '').toLowerCase().trim() || String(c.userIndex !== undefined ? c.userIndex : '0');
            if (key !== accountKey) return false;
            // UNBREAKABLE SCHEDULING: Only trigger if due now! Never trigger future-scheduled campaigns prematurely.
            if (!c.scheduledAt) return true;
            const schedTime = new Date(c.scheduledAt).getTime();
            return !isNaN(schedTime) && schedTime <= now;
          })
          .sort((a, b) => new Date(a.scheduledAt || a.createdAt || 0) - new Date(b.scheduledAt || b.createdAt || 0));

        if (dueForAccount.length > 0) {
          console.log(`[ServiceWorker] ⏩ Processing next due campaign for account "${accountKey}": ${dueForAccount[0].id}`);
          await executeCampaign(dueForAccount[0]);
          return;
        }
      }

      // 2. Or trigger due check to dispatch any other queued accounts into free slots
      await checkAndExecuteDueCampaigns();
    } catch (err) {
      console.error(`[ServiceWorker] Error processing next queue for ${accountKey}:`, err);
    }
  }, 3500);
}

/**
 * Pauses all pending campaigns for an account for 12 hours when Google Daily Sending Limit is hit.
 * @param {string} accountEmail
 */
async function pauseAccountCampaignsForQuota(accountEmail) {
  try {
    if (!self.IDBStore) return;
    const targetEmail = (accountEmail || '').toLowerCase().trim();
    const campaigns = await self.IDBStore.getCampaigns();
    const twelveHoursLater = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    let count = 0;

    for (const c of campaigns) {
      if (c.status === 'QUEUED') {
        const cEmail = (c.accountEmail || '').toLowerCase().trim();
        if (!targetEmail || cEmail === targetEmail) {
          await self.IDBStore.updateCampaign(c.id, {
            scheduledAt: twelveHoursLater
          });
          await self.IDBStore.addLog(
            c.id,
            'WARN',
            `Campaign postponed by 12 hours due to Google Daily Sending Limit reached on account "${targetEmail || 'default'}".`
          );
          count++;
        }
      }
    }

    notifyDesktop(
      '⚠️ Google Sending Limit Reached',
      `Daily limit reached for ${targetEmail || 'your account'}. ${count} pending campaign(s) paused for 12 hours.`,
      true
    );
  } catch (err) {
    console.error('[ServiceWorker] Error pausing campaigns for quota limit:', err);
  }
}

/**
 * Ponytail-lean Chrome desktop notification helper
 */
function notifyDesktop(title, message, isError = false) {
  try {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: title,
        message: message || ''
      }, () => {});
    }
  } catch (_) {}
}

/**
 * Finds the most suitable open Gmail tab and updates the Account Tab Registry.
 * Enforces Strict Account Isolation (per Devil & Ponytail decision).
 * @param {Object} [campaign]
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findGmailTab(campaign) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (!tabs || tabs.length === 0) {
    return null;
  }

  const targetEmail = (campaign?.accountEmail || '').toLowerCase().trim();
  let matchedTab = null;

  // 1. Build and update the Account Tab Registry dynamically
  for (const t of tabs) {
    try {
      await chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
      const info = await chrome.tabs.sendMessage(t.id, { action: 'GET_TAB_ACCOUNT_INFO' }).catch(() => null);
      if (info && info.email) {
        const cleanEmail = info.email.toLowerCase().trim();
        accountTabRegistry.set(cleanEmail, t.id);

        if (targetEmail && cleanEmail === targetEmail) {
          matchedTab = t;
        }
      }
    } catch (_) {}
  }

  // 2. If no exact email match, match by target userIndex URL
  if (!matchedTab && campaign) {
    let targetPath = null;
    if (campaign.accountUrl) {
      const match = campaign.accountUrl.match(/\/mail\/u\/(\d+)/);
      if (match) targetPath = `/mail/u/${match[1]}/`;
    } else if (campaign.userIndex !== undefined) {
      targetPath = `/mail/u/${campaign.userIndex}/`;
    }

    if (targetPath) {
      matchedTab = tabs.find((t) => t.url && t.url.includes(targetPath));
    }
  }

  // Strict Account Isolation: NEVER blindly fallback to tabs[0] of another account!
  // Return matchedTab or null so executeCampaign opens a dedicated tab for this specific account.
  if (!matchedTab) {
    if (targetEmail || (campaign && campaign.userIndex !== undefined)) {
      console.log(`[ServiceWorker] 🛡️ Strict Account Isolation: No matching tab found for account "${targetEmail || campaign?.userIndex || 'default'}". Will create isolated dedicated tab.`);
      return null;
    }
    // Only if no account was specified at all, fallback to active tab
    matchedTab = tabs.find((t) => t.active) || tabs[0];
  }

  // 3. Handle Discarded Tabs (Chrome Memory Saver Recovery)
  if (matchedTab && matchedTab.discarded) {
    console.log(`[ServiceWorker] 💤 Gmail tab ${matchedTab.id} was discarded. Hard reloading (bypassCache)...`);
    await chrome.tabs.reload(matchedTab.id, { bypassCache: true });
    await waitForTabComplete(matchedTab.id, 25000);
    await delay(2500);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: matchedTab.id },
        files: ['src/db/idb-store.js', 'src/content/gmail-automator.js', 'src/content/content.js']
      });
    } catch (_) {}
  }

  return matchedTab;
}

/**
 * Waits for a newly opened tab to finish loading.
 * @param {number} tabId
 * @param {number} timeoutMs
 */
function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise(async (resolve) => {
    let timer = null;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (timer) clearTimeout(timer);
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);

    // Fast path: check if tab is already complete
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === 'complete') {
        cleanup();
        resolve(true);
      }
    } catch (_) {}
  });
}

/**
 * Dispatches a message to a tab with retry logic and automatic context recovery.
 * If the extension was reloaded, auto-injects scripts and reloads the pinned tab if needed.
 * @param {number} tabId
 * @param {Object} message
 * @param {number} maxRetries
 */
async function sendMessageWithRetry(tabId, message, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response || true;
    } catch (err) {
      console.warn(`[ServiceWorker] Message dispatch attempt ${attempt} to tab ${tabId} failed:`, err.message);

      const isContextDead = err.message && (
        err.message.includes('Receiving end does not exist') ||
        err.message.includes('Extension context invalidated') ||
        err.message.includes('Could not establish connection')
      );

      if (isContextDead) {
        // Recovery 1: Dynamically re-inject content scripts into the tab
        if (attempt === 1 && chrome.scripting) {
          try {
            console.log(`[ServiceWorker] Dynamically injecting content scripts into tab ${tabId}...`);
            await chrome.scripting.executeScript({
              target: { tabId },
              files: [
                'src/db/idb-store.js',
                'src/content/gmail-automator.js',
                'src/content/content.js'
              ]
            });
            await delay(1200);
            continue;
          } catch (injectErr) {
            console.warn('[ServiceWorker] Dynamic script injection failed:', injectErr.message);
          }
        }

        // Recovery 2: Auto-reload the tab if context was invalidated by extension reload
        if (attempt >= 2) {
          try {
            console.log(`[ServiceWorker] Auto-reloading (hard reload, bypassCache) pinned Gmail tab ${tabId} to restore fresh extension context...`);
            await chrome.tabs.reload(tabId, { bypassCache: true });
            await waitForTabComplete(tabId, 25000);
            await delay(4000); // 4s buffer for Gmail client hydration
            continue;
          } catch (reloadErr) {
            console.warn('[ServiceWorker] Tab reload recovery failed:', reloadErr.message);
          }
        }
      }

      if (attempt < maxRetries) {
        await delay(1500 * attempt);
      }
    }
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// BADGE MANAGEMENT
// =============================================================================

/**
 * Refreshes the extension icon badge to show pending or queued campaigns.
 */
async function refreshBadge() {
  try {
    if (!self.IDBStore) return;

    const campaigns = await self.IDBStore.getCampaigns();
    const queuedCount = campaigns.filter(
      (c) => c.status === 'QUEUED' || c.status === 'PROCESSING'
    ).length;

    if (queuedCount > 0) {
      await chrome.action.setBadgeText({ text: String(queuedCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' }); // Google Blue
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('[ServiceWorker] Error refreshing badge:', err);
  }
}

// =============================================================================
// RUNTIME MESSAGE HANDLING
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((err) => {
      console.error('[ServiceWorker] Error handling message:', err);
      sendResponse({ success: false, error: err.message || String(err) });
    });

  // Return true to indicate asynchronous response callback
  return true;
});

async function handleRuntimeMessage(message, sender) {
  if (!message || typeof message !== 'object') {
    return { success: false, error: 'Invalid message payload' };
  }

  switch (message.action) {
    case 'GET_SCHEDULER_STATUS': {
      const alarm = await chrome.alarms.get(ALARM_NAME);
      const campaigns = self.IDBStore ? await self.IDBStore.getCampaigns() : [];
      const dueCampaigns = self.IDBStore ? await self.IDBStore.getDueCampaigns() : [];

      const queuedCount = campaigns.filter((c) => c.status === 'QUEUED').length;
      const processingCount = campaigns.filter((c) => c.status === 'PROCESSING').length;
      const completedCount = campaigns.filter((c) => c.status === 'COMPLETED').length;

      const activeAccounts = Array.from(accountLocks.entries()).map(([k, v]) => ({
        accountKey: k,
        campaignId: v.campaignId,
        startedAt: v.startedAt
      }));

      return {
        success: true,
        status: {
          alarmActive: !!alarm,
          nextScheduledPoll: alarm ? new Date(alarm.scheduledTime).toISOString() : null,
          periodMinutes: alarm ? alarm.periodInMinutes : null,
          dueCount: dueCampaigns.length,
          queuedCount,
          processingCount,
          completedCount,
          maxConcurrentAccounts: MAX_CONCURRENT_ACCOUNTS,
          activeAccountCount: accountLocks.size,
          activeAccounts,
          isWakeLockActive: !!isWakeLockActive,
          timestamp: new Date().toISOString()
        }
      };
    }

    case 'TRIGGER_CAMPAIGN_NOW': {
      if (message.campaignId) {
        const campaign = await self.IDBStore.getCampaignById(message.campaignId);
        if (!campaign) {
          return { success: false, error: `Campaign with id "${message.campaignId}" not found.` };
        }
        if (campaign.canAutoRetry === false || campaign.errorCategory === 'DRAFT_NOT_FOUND' || (campaign.errorMessage && campaign.errorMessage.includes('[DRAFT_NOT_FOUND]'))) {
          return { success: false, error: 'Cannot retry: draft was deleted or not found in Gmail. Please re-schedule.' };
        }

        await self.IDBStore.updateCampaign(campaign.id, {
          status: 'QUEUED',
          progressStep: 'QUEUED',
          progressMessage: 'Waiting in queue...',
          progressPct: 0,
          errorMessage: null,
          errorCategory: null,
          failedAt: null,
          scheduledAt: new Date().toISOString()
        });
        await self.IDBStore.addLog(campaign.id, 'INFO', 'Campaign queued for immediate execution.');

        const accountKey = (campaign.accountEmail || '').toLowerCase().trim() || String(campaign.userIndex !== undefined ? campaign.userIndex : '0');
        if (isAccountExecuting(accountKey) || accountLocks.size >= MAX_CONCURRENT_ACCOUNTS) {
          await refreshBadge();
          return { success: true, queued: true, message: `Campaign queued in account pipeline behind active dispatch.` };
        } else {
          executeCampaign(campaign).catch((err) => console.error('[ServiceWorker] Trigger error:', err));
          await refreshBadge();
          return { success: true, started: true, message: `Campaign "${campaign.id}" triggered.` };
        }
      } else {
        await checkAndExecuteDueCampaigns();
        return { success: true, message: 'Scheduler poll executed immediately.' };
      }
    }

    case 'REGISTER_SCHEDULED_ALARM': {
      if (message.campaign && self.IDBStore) {
        try {
          await self.IDBStore.saveCampaign(message.campaign);
        } catch (dbErr) {
          console.warn('[ServiceWorker] Note on saving campaign in central store:', dbErr.message);
        }
      }
      if (message.campaignId && message.scheduledTime) {
        if (message.scheduledTime <= Date.now() + 5000) {
          console.log(`[ServiceWorker] Campaign ${message.campaignId} is due immediately. Executing check...`);
          checkAndExecuteDueCampaigns().catch(() => {});
        } else {
          chrome.alarms.create(`CAMPAIGN_${message.campaignId}`, {
            when: message.scheduledTime
          });
          console.log(`[ServiceWorker] Registered exact alarm for campaign ${message.campaignId} at ${new Date(message.scheduledTime).toISOString()}`);
        }
      }
      await refreshBadge();
      await syncSystemWakeLock();
      return { success: true };
    }

    case 'SYNC_CAMPAIGNS': {
      if (Array.isArray(message.campaigns) && self.IDBStore) {
        let addedCount = 0;
        for (const camp of message.campaigns) {
          try {
            const existing = await self.IDBStore.getCampaignById(camp.id);
            if (!existing) {
              await self.IDBStore.saveCampaign(camp);
              addedCount++;
              if (camp.status === 'QUEUED' && camp.scheduledAt) {
                const schedTime = new Date(camp.scheduledAt).getTime();
                if (schedTime > Date.now()) {
                  chrome.alarms.create(`CAMPAIGN_${camp.id}`, { when: schedTime });
                  console.log(`[ServiceWorker] Synced alarm created for ${camp.id} at ${camp.scheduledAt}`);
                }
              }
            }
          } catch (syncErr) {
            console.warn('[ServiceWorker] Campaign sync item note:', syncErr.message);
          }
        }
        if (addedCount > 0) {
          console.log(`[ServiceWorker] Synced ${addedCount} campaign(s) from Gmail tab.`);
          await refreshBadge();
        }
      }
      return { success: true };
    }

    case 'REFRESH_BADGE': {
      await refreshBadge();
      return { success: true };
    }

    case 'GET_MISSED_CAMPAIGNS': {
      if (self.IDBStore) {
        const campaigns = await self.IDBStore.getCampaigns();
        const missed = campaigns.filter((c) => c.status === 'MISSED_OFFLINE');
        return { success: true, campaigns: missed };
      }
      return { success: true, campaigns: [] };
    }

    case 'RESCHEDULE_CAMPAIGN': {
      if (!message.campaignId || !message.scheduledTime) {
        return { success: false, error: 'Missing campaignId or scheduledTime' };
      }
      const isoDate = new Date(message.scheduledTime).toISOString();
      if (self.IDBStore) {
        await self.IDBStore.updateCampaign(message.campaignId, {
          scheduledAt: isoDate,
          status: 'QUEUED',
          missedAt: null
        });
        await self.IDBStore.addLog(message.campaignId, 'INFO', `Rescheduled to ${isoDate}`);
      }
      if (message.scheduledTime <= Date.now() + 5000) {
        checkAndExecuteDueCampaigns().catch(() => {});
      } else {
        chrome.alarms.create(`CAMPAIGN_${message.campaignId}`, {
          when: message.scheduledTime
        });
      }
      await refreshBadge();
      return { success: true };
    }

    case 'DISMISS_MISSED_CAMPAIGN': {
      if (message.campaignId && self.IDBStore) {
        await self.IDBStore.updateCampaign(message.campaignId, {
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString()
        });
        await self.IDBStore.addLog(message.campaignId, 'INFO', 'Missed campaign dismissed by user.');
        await refreshBadge();
        return { success: true };
      }
      return { success: false, error: 'Missing campaignId' };
    }

    case 'OPEN_DASHBOARD': {
      const baseDashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
      const targetUrl = message.targetTab ? `${baseDashboardUrl}#${message.targetTab}` : baseDashboardUrl;
      const tabs = await chrome.tabs.query({ url: `${baseDashboardUrl}*` });

      if (tabs && tabs.length > 0) {
        // Switch to existing dashboard tab and update hash if specified
        await chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl });
        if (tabs[0].windowId) {
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        }
        return { success: true, tabId: tabs[0].id, existing: true };
      } else {
        // Create new tab
        const newTab = await chrome.tabs.create({ url: targetUrl });
        return { success: true, tabId: newTab.id, existing: false };
      }
    }

    case 'RELOAD_GMAIL_TABS': {
      const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
      console.log(`[ServiceWorker] 🔄 Manual refresh requested for ${tabs.length} Gmail tab(s)...`);
      for (const t of tabs) {
        await chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
        await chrome.tabs.reload(t.id, { bypassCache: true }).catch(() => {});
      }
      return { success: true, count: tabs.length };
    }

    case 'CAMPAIGN_STATUS_UPDATE': {
      // Content script reporting completion or progress
      if (message.campaignId && message.status) {
        let willAutoRetry = false;

        if (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)') {
          await self.IDBStore.updateCampaign(message.campaignId, {
            status: message.status,
            sentCount: message.sentCount !== undefined ? message.sentCount : undefined,
            recipientCount: message.recipientCount !== undefined ? message.recipientCount : undefined,
            failedCount: message.failedCount !== undefined ? message.failedCount : undefined,
            autoRetryCount: 0,
            completedAt: new Date().toISOString()
          });
        } else if (message.status === 'FAILED') {
          const isQuota = message.isQuotaLimit || (message.logMessage && message.logMessage.includes('Daily Sending Limit'));
          const isDraftMissing = message.errorCategory === 'DRAFT_NOT_FOUND' || message.canAutoRetry === false || (message.logMessage && message.logMessage.includes('[DRAFT_NOT_FOUND]'));
          const isFatal = isQuota || isDraftMissing;

          const currentCamp = await self.IDBStore.getCampaignById(message.campaignId);
          const retryCount = ((currentCamp && currentCamp.autoRetryCount) || 0) + 1;

          if (!isFatal && retryCount <= RETRY_CONFIG.maxRetries) {
            willAutoRetry = true;
            const delayMs = RETRY_CONFIG.backoff[retryCount - 1] || 60000;
            const nextTime = Date.now() + delayMs;
            console.warn(`[ServiceWorker] 🔁 Transient merge failure for campaign ${message.campaignId}. Auto-recovering in ${Math.round(delayMs / 1000)}s with exponential backoff (attempt ${retryCount}/${RETRY_CONFIG.maxRetries})...`);

            await self.IDBStore.updateCampaign(message.campaignId, {
              status: 'QUEUED',
              scheduledAt: new Date(nextTime).toISOString(),
              autoRetryCount: retryCount,
              errorMessage: message.logMessage || message.error || 'Execution interrupted',
              progressMessage: `Auto-recovering in ${Math.round(delayMs / 1000)}s (attempt ${retryCount}/${RETRY_CONFIG.maxRetries})...`
            });
            await self.IDBStore.addLog(
              message.campaignId,
              'WARN',
              `Dispatch failed: ${message.logMessage || 'Execution interrupted'}. Automatically recovering in ${Math.round(delayMs / 1000)}s with exponential backoff (attempt ${retryCount}/${RETRY_CONFIG.maxRetries}).`
            );
            chrome.alarms.create(`CAMPAIGN_${message.campaignId}`, { when: nextTime });
          } else {
            await self.IDBStore.updateCampaign(message.campaignId, {
              status: 'FAILED',
              errorMessage: message.logMessage || message.error || 'Execution failed',
              errorCategory: message.errorCategory || undefined,
              canAutoRetry: !isDraftMissing && !isQuota,
              failedAt: new Date().toISOString()
            });
          }
        } else {
          await self.IDBStore.updateCampaign(message.campaignId, {
            status: message.status
          });
        }

        if (message.logMessage && !willAutoRetry) {
          await self.IDBStore.addLog(
            message.campaignId,
            message.logLevel || (message.status === 'FAILED' ? 'ERROR' : 'INFO'),
            message.logMessage
          );
        }
        await refreshBadge();

        // Clean Auto-Close: close the dedicated execution tab on completion or failure
        const activeTabInfo = ACTIVE_CAMPAIGN_TABS.get(message.campaignId);
        if (activeTabInfo && (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)' || message.status === 'FAILED')) {
          if (activeTabInfo.timeoutId) clearTimeout(activeTabInfo.timeoutId);
          setTimeout(() => {
            chrome.tabs.remove(activeTabInfo.tabId).catch(() => {});
          }, 3000);
          ACTIVE_CAMPAIGN_TABS.delete(message.campaignId);
        }

        // Release account execution lock and trigger next queued campaign
        if (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)' || message.status === 'FAILED') {
          const currentCamp = await self.IDBStore.getCampaignById(message.campaignId);
          const acctKey = (message.accountEmail || currentCamp?.accountEmail || '').toLowerCase().trim() || String(currentCamp?.userIndex !== undefined ? currentCamp?.userIndex : '0');
          releaseAccountLock(acctKey, message.campaignId).catch(() => {});
        }

        if (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)') {
          notifyDesktop(
            '✅ Mail Merge Completed',
            `Campaign sent${message.sentCount ? ' to ' + message.sentCount + ' recipients' : ''}.`
          );
        } else if (message.status === 'FAILED' && !willAutoRetry) {
          if (message.isQuotaLimit || (message.logMessage && message.logMessage.includes('Daily Sending Limit'))) {
            pauseAccountCampaignsForQuota(message.accountEmail);
          }
          notifyDesktop(
            '❌ Mail Merge Error',
            `Campaign failed: ${message.logMessage || 'Execution failed'}`,
            true
          );
        }

        syncSystemWakeLock().catch(() => {});
        return { success: true };
      }
      return { success: false, error: 'Missing campaignId or status' };
    }

    case 'CAMPAIGN_PROGRESS': {
      if (message.campaignId && self.IDBStore) {
        await self.IDBStore.updateCampaign(message.campaignId, {
          status: 'PROCESSING',
          progressStep: message.step,
          progressMessage: message.message,
          progressPct: message.pct
        }).catch(() => {});
      }
      return { success: true };
    }

    case 'RETRY_ALL_FAILED': {
      if (!self.IDBStore) {
        return { success: false, error: 'Database not ready' };
      }
      const campaigns = await self.IDBStore.getCampaigns();
      const retryable = campaigns.filter(
        (c) => c.status === 'FAILED' && c.canAutoRetry !== false && c.errorCategory !== 'DRAFT_NOT_FOUND' && !(c.errorMessage && c.errorMessage.includes('[DRAFT_NOT_FOUND]'))
      );

      for (const camp of retryable) {
        await self.IDBStore.updateCampaign(camp.id, {
          status: 'QUEUED',
          progressStep: 'QUEUED',
          progressMessage: 'Queued in line...',
          progressPct: 0,
          errorMessage: null,
          errorCategory: null,
          failedAt: null,
          scheduledAt: new Date().toISOString()
        });
        await self.IDBStore.addLog(camp.id, 'INFO', 'Campaign re-queued for execution via Retry All.');
      }

      checkAndExecuteDueCampaigns().catch((err) => console.error('[ServiceWorker] Retry all error:', err));
      await refreshBadge();
      return { success: true, count: retryable.length };
    }

    case 'DELETE_ALL_FAILED': {
      if (!self.IDBStore) {
        return { success: false, error: 'Database not ready' };
      }
      let removedCount = 0;
      if (typeof self.IDBStore.archiveFailedCampaigns === 'function') {
        removedCount = await self.IDBStore.archiveFailedCampaigns();
      } else {
        const campaigns = await self.IDBStore.getCampaigns();
        const failed = campaigns.filter((c) => c.status === 'FAILED');
        for (const camp of failed) {
          try {
            await self.IDBStore.deleteCampaign(camp.id);
            await chrome.alarms.clear(`CAMPAIGN_${camp.id}`).catch(() => {});
            removedCount++;
          } catch (delErr) {
            console.warn(`[ServiceWorker] Error deleting failed campaign ${camp.id}:`, delErr.message);
          }
        }
      }

      await self.IDBStore.addLog(null, 'INFO', `Safely archived and removed ${removedCount} failed campaign(s) from active database.`);
      await refreshBadge();
      await syncSystemWakeLock();
      return { success: true, count: removedCount };
    }

    case 'ARCHIVE_CAMPAIGN': {
      if (!self.IDBStore || !message.campaignId) {
        return { success: false, error: 'Invalid archive request' };
      }
      try {
        const archived = await self.IDBStore.archiveCampaign(message.campaignId);
        await chrome.alarms.clear(`CAMPAIGN_${message.campaignId}`).catch(() => {});
        await refreshBadge();
        await syncSystemWakeLock();
        return { success: true, campaign: archived };
      } catch (archErr) {
        return { success: false, error: archErr.message };
      }
    }

    case 'CAPTURE_TAB_FORENSIC': {
      const tab = sender.tab || (message.tabId ? await chrome.tabs.get(message.tabId).catch(() => null) : null);
      let screenshotDataUrl = null;

      if (tab && tab.windowId) {
        try {
          screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'jpeg',
            quality: 70
          });
        } catch (capErr) {
          console.warn('[ServiceWorker] captureVisibleTab note:', capErr.message);
        }
      }

      let captureRecord = null;
      if (self.IDBStore) {
        try {
          captureRecord = await self.IDBStore.saveForensicCapture({
            campaignId: message.campaignId,
            stage: message.stage,
            screenshotUrl: screenshotDataUrl,
            popupTitle: message.popupInfo?.title || null,
            popupBody: message.popupInfo?.body || null,
            domSnippet: message.domSnippet || null,
            errorMessage: message.errorMessage || null,
            url: tab?.url || null,
            timestamp: new Date().toISOString()
          });

          await self.IDBStore.addLog(
            message.campaignId,
            'WARN',
            `[VISUAL FORENSIC] Screen observation recorded at stage "${message.stage}"${screenshotDataUrl ? ' (Screenshot saved)' : ''}.`
          ).catch(() => {});
        } catch (dbErr) {
          console.warn('[ServiceWorker] Error saving forensic record:', dbErr.message);
        }
      }

      return {
        success: true,
        captureId: captureRecord?.id,
        hasScreenshot: !!screenshotDataUrl
      };
    }

    case 'SCAN_OPEN_GMAIL_DRAFTS': {
      const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
      if (!tabs || tabs.length === 0) {
        return { success: true, drafts: [], message: 'No open Gmail tabs detected' };
      }

      const targetEmail = (message.accountEmail || '').toLowerCase().trim();
      const targetUserIndex = message.userIndex !== undefined && message.userIndex !== null ? String(message.userIndex) : null;
      const allDrafts = [];
      const seenDraftIds = new Set();

      for (const t of tabs) {
        try {
          const resp = await chrome.tabs.sendMessage(t.id, { action: 'SCAN_COMPOSE_WINDOWS' });
          if (resp && resp.success && Array.isArray(resp.drafts)) {
            for (const d of resp.drafts) {
              const draftKey = d.draftId || `${t.id}_${d.subject}_${d.sheetTitle || ''}`;
              if (seenDraftIds.has(draftKey)) continue;
              seenDraftIds.add(draftKey);

              const draftEmail = (d.accountEmail || '').toLowerCase().trim();
              const draftUserIndex = d.userIndex !== undefined ? String(d.userIndex) : null;

              const matchesEmail = Boolean(targetEmail && draftEmail && draftEmail === targetEmail);
              const matchesUserIndex = Boolean(targetUserIndex !== null && draftUserIndex !== null && draftUserIndex === targetUserIndex);
              const matchesAccount = matchesEmail || matchesUserIndex || (!targetEmail && targetUserIndex === null);

              allDrafts.push({
                ...d,
                tabId: t.id,
                matchesAccount
              });
            }
          }
        } catch (_) {
          // Tab may not have content script injected yet or is loading
        }
      }

      // Sort matching drafts first
      allDrafts.sort((a, b) => (b.matchesAccount ? 1 : 0) - (a.matchesAccount ? 1 : 0));

      return { success: true, drafts: allDrafts };
    }

    case 'REBIND_AND_QUEUE_CAMPAIGN': {
      if (!message.campaignId || !message.draftId) {
        return { success: false, error: 'Missing campaignId or draftId' };
      }
      if (!self.IDBStore) {
        return { success: false, error: 'Database not initialized' };
      }

      const campaign = await self.IDBStore.getCampaignById(message.campaignId);
      if (!campaign) {
        return { success: false, error: `Campaign "${message.campaignId}" not found.` };
      }

      const updates = {
        draftId: message.draftId,
        errorMessage: null,
        errorCategory: null,
        failedAt: null,
        canAutoRetry: true
      };

      if (message.subject) updates.subject = message.subject;
      if (message.sheetTitle) {
        updates.sheetTitle = message.sheetTitle;
        updates.spreadsheetTitle = message.sheetTitle;
      }
      if (message.sheetUrl) {
        updates.sheetUrl = message.sheetUrl;
        updates.spreadsheetUrl = message.sheetUrl;
      }
      if (message.recipientCount !== undefined && message.recipientCount > 0) {
        updates.recipientCount = message.recipientCount;
      }

      if (message.dispatchTiming === 'scheduled' && message.scheduledTime) {
        const schedTime = new Date(message.scheduledTime).getTime();
        const isoDate = new Date(schedTime).toISOString();
        updates.status = 'QUEUED';
        updates.progressStep = 'SCHEDULED';
        updates.progressMessage = `Scheduled for ${new Date(schedTime).toLocaleString()}`;
        updates.progressPct = 0;
        updates.scheduledAt = isoDate;

        await self.IDBStore.updateCampaign(campaign.id, updates);
        await self.IDBStore.addLog(campaign.id, 'INFO', `Draft rebound to "${message.draftId}". Rescheduled for ${isoDate}`);

        if (schedTime <= Date.now() + 5000) {
          checkAndExecuteDueCampaigns().catch(() => {});
        } else {
          chrome.alarms.create(`CAMPAIGN_${campaign.id}`, { when: schedTime });
        }
        await refreshBadge();
        return { success: true, mode: 'scheduled', scheduledAt: isoDate };
      } else {
        // Immediate queue dispatch
        updates.status = 'QUEUED';
        updates.progressStep = 'QUEUED';
        updates.progressMessage = 'Waiting in queue...';
        updates.progressPct = 0;
        updates.scheduledAt = new Date().toISOString();

        await self.IDBStore.updateCampaign(campaign.id, updates);
        await self.IDBStore.addLog(campaign.id, 'INFO', `Draft rebound to "${message.draftId}". Queued for immediate execution.`);

        const accountKey = (campaign.accountEmail || '').toLowerCase().trim() || String(campaign.userIndex !== undefined ? campaign.userIndex : '0');
        if (isAccountExecuting(accountKey) || accountLocks.size >= MAX_CONCURRENT_ACCOUNTS) {
          await refreshBadge();
          return { success: true, mode: 'queued', message: `Campaign queued in account pipeline behind active dispatch.` };
        } else {
          const updatedCampaign = await self.IDBStore.getCampaignById(campaign.id);
          executeCampaign(updatedCampaign).catch((err) => console.error('[ServiceWorker] Rebind trigger error:', err));
          await refreshBadge();
          return { success: true, mode: 'immediate', message: `Campaign dispatched immediately.` };
        }
      }
    }

    case 'AUTOMATE_DRIVE_PICKER': {
      // Executes picker script into all frames of the active tab
      const tabId = sender.tab?.id || (await findGmailTab())?.id;
      if (!tabId || !chrome.scripting) {
        return { success: false, error: 'Cannot access tab for picker automation' };
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: async (query, title) => {
            if (!location.href.includes('picker') && !location.href.includes('drive.google.com')) {
              return null; // Ignore non-picker frames
            }

            console.log('[PickerFrame] Inside picker frame:', location.href);

            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const findInput = () => document.querySelector('input[aria-label*="Search" i], input[placeholder*="Search" i], input[type="text"]');

            let searchInput = null;
            for (let i = 0; i < 30; i++) {
              searchInput = findInput();
              if (searchInput) break;
              await sleep(300);
            }

            if (!searchInput) return { found: false, error: 'Search input not found in picker frame' };

            // Fill query and submit
            searchInput.focus();
            searchInput.value = query;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));

            await sleep(3000);

            // Find matching row
            let row = document.querySelector('div[role="row"], div[role="option"], div[role="gridcell"], .picker-grid-item');
            if (!row && title && title !== query) {
              // Retry with title
              searchInput.focus();
              searchInput.value = title;
              searchInput.dispatchEvent(new Event('input', { bubbles: true }));
              searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              await sleep(3000);
              row = document.querySelector('div[role="row"], div[role="option"], div[role="gridcell"]');
            }

            if (!row) return { found: false, error: 'No matching file item found in picker' };

            row.click();
            await sleep(1000);

            // Click Select / Insert button
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const selectBtn = buttons.find((b) => /^(Insert|Select|OK)$/i.test((b.textContent || '').trim())) ||
              document.querySelector('button[name="ok"]');

            if (selectBtn) {
              selectBtn.click();
              return { success: true };
            }

            return { found: true, clickedRow: true };
          },
          args: [message.query, message.fallbackTitle || '']
        });

        const frameResult = results?.find((r) => r.result && (r.result.success || r.result.clickedRow));
        return frameResult ? { success: true } : { success: false, error: 'No picker frame acknowledged selection' };
      } catch (pickerErr) {
        return { success: false, error: pickerErr.message };
      }
    }

    case 'TOGGLE_SCHEDULER': {
      const alarm = await chrome.alarms.get(ALARM_NAME);
      let isNowActive = false;
      if (alarm) {
        await chrome.alarms.clear(ALARM_NAME);
        isNowActive = false;
        if (self.IDBStore) {
          await self.IDBStore.setSetting('scheduler_active', false);
          await self.IDBStore.addLog(null, 'INFO', 'Scheduler paused by user.');
        }
      } else {
        await chrome.alarms.create(ALARM_NAME, {
          periodInMinutes: POLL_INTERVAL_MINUTES
        });
        isNowActive = true;
        if (self.IDBStore) {
          await self.IDBStore.setSetting('scheduler_active', true);
          await self.IDBStore.addLog(null, 'INFO', 'Scheduler resumed by user.');
        }
      }
      return { success: true, active: isNowActive };
    }

    default:
      return { success: false, error: `Unhandled action: ${message.action}` };
  }
}
