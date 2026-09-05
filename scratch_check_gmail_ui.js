const { chromium } = require('D:/projects/email_automation/node_modules/playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const extensionPath = path.resolve(__dirname);
  const profileDir = path.resolve(__dirname, '.live-profile');
  const resultsDir = path.resolve(__dirname, 'test-results');

  console.log('Testing Gmail Compose UI injection with extension...');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--start-maximized',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ],
    viewport: null
  });

  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('MailMerge') || text.includes('ComposeInjector') || text.includes('Error') || text.includes('error')) {
      consoleLogs.push(`[${msg.type()}] ${text}`);
      console.log(`[Browser Console]:`, text);
    }
  });
  page.on('pageerror', err => {
    console.log(`[Page Error]:`, err.message);
    consoleLogs.push(`[PAGE_ERROR] ${err.message}`);
  });

  console.log('Navigating to Gmail...');
  await page.goto('https://mail.google.com/mail/u/0/#inbox?compose=new', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // Take screenshot of Gmail
  await page.screenshot({ path: path.join(resultsDir, 'debug-gmail-compose-initial.png') });
  console.log('Saved debug-gmail-compose-initial.png');

  // Check for compose dialogs in page
  const composeCount = await page.locator('div[role="dialog"], div[data-compose-id], div.M9').count();
  console.log('Compose dialog elements found in DOM:', composeCount);

  // Check if our extension injected button or panel
  const injectedButtons = await page.locator('[data-mail-merge-btn-injected="true"]').count();
  const injectedPanels = await page.locator('#gmail-mail-merge-panel-root').count();
  console.log('Injected Mail Merge Buttons:', injectedButtons);
  console.log('Injected Panels:', injectedPanels);

  // Click the injected button if visible
  if (injectedButtons > 0) {
    console.log('Clicking the injected "⚡ Mail Merge" button...');
    await page.locator('[data-mail-merge-btn-injected="true"]').first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(resultsDir, 'debug-gmail-after-button-click.png') });
    console.log('Saved debug-gmail-after-button-click.png');
    console.log('Panels after click:', await page.locator('#gmail-mail-merge-panel-root').count());
  }

  // Also check what compose toolbar elements exist
  const toolbarHtml = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return 'No dialog';
    const toolbars = Array.from(dialog.querySelectorAll('[role="toolbar"], .btC, tr.btC, .aDh'));
    return toolbars.map(t => ({ class: t.className, tag: t.tagName, children: t.children.length, text: t.innerText.slice(0, 100) }));
  });
  console.log('Toolbar diagnostics:', JSON.stringify(toolbarHtml, null, 2));

  fs.writeFileSync(path.join(resultsDir, 'debug-console-logs.txt'), consoleLogs.join('\n'));
  await context.close();
  console.log('Test completed.');
})();
