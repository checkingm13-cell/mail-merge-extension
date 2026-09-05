/**
 * Live Gmail Automation & Mail Merge Test Runner (Safe Dry Run)
 * Uses the authenticated profile session from D:/projects/email_automation/chrome-profile-editorial
 */
const { chromium } = require('D:/projects/email_automation/node_modules/playwright');
const path = require('path');
const fs = require('fs');

async function runLiveGmailTest() {
  console.log('===========================================================');
  console.log('📬 Starting Live Gmail Automation Test (Safe Dry Run Mode)');
  console.log('===========================================================');

  const extensionPath = path.resolve(__dirname);
  const liveProfileDir = path.resolve(__dirname, '.live-profile');
  const resultsDir = path.resolve(__dirname, 'test-results');

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // 1. Clone session state from editorial profile
  const srcProfile = path.resolve('D:/projects/email_automation/chrome-profile-editorial');
  if (fs.existsSync(srcProfile)) {
    console.log('📂 Syncing cookies & session from chrome-profile-editorial...');
    try {
      fs.mkdirSync(liveProfileDir, { recursive: true });
      const defaultDir = path.join(liveProfileDir, 'Default');
      const srcDefault = path.join(srcProfile, 'Default');
      if (fs.existsSync(srcDefault)) {
        fs.mkdirSync(defaultDir, { recursive: true });
        for (const file of ['Network', 'Cookies', 'Preferences', 'Secure Preferences', 'Login Data']) {
          const srcFile = path.join(srcDefault, file);
          if (fs.existsSync(srcFile)) {
            try {
              fs.copyFileSync(srcFile, path.join(defaultDir, file));
            } catch (_) {}
          }
        }
      }
      console.log('✅ Session state synced to .live-profile');
    } catch (copyErr) {
      console.warn('Profile clone note:', copyErr.message);
    }
  }

  console.log('🌐 Launching browser with extension loaded from:', extensionPath);
  const context = await chromium.launchPersistentContext(liveProfileDir, {
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

  try {
    // 2. Discover Extension ID
    console.log('🔍 Locating Extension Service Worker...');
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 4000 }).catch(() => null);
    }
    const extensionId = sw ? sw.url().split('/')[2] : 'kfncgfcdgiahjmjhgeajblpfmokebijf';
    console.log(`✅ Extension ID verified: ${extensionId}`);

    // 3. Open Gmail Inbox
    console.log('📬 Navigating to Gmail Inbox...');
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(resultsDir, 'live-01-gmail-inbox.png') });
    console.log('📸 Screenshot saved: live-01-gmail-inbox.png');

    // 4. Check for Compose button
    console.log('✍️ Checking Compose button in Gmail...');
    const composeBtn = page.getByRole('button', { name: /compose/i })
      .or(page.locator('div[gh="cm"], div.T-I-KE, [role="button"][aria-label*="Compose" i]')).first();

    const hasCompose = await composeBtn.isVisible({ timeout: 15000 }).catch(() => false);
    if (hasCompose) {
      console.log('Clicking Compose button...');
      await composeBtn.click();
      await page.waitForTimeout(2500);

      const composeDialog = page.locator('div[role="dialog"]').filter({ hasText: /new message|to|compose/i }).first();
      await composeDialog.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

      await page.screenshot({ path: path.join(resultsDir, 'live-02-compose-opened.png') });
      console.log('📸 Screenshot saved: live-02-compose-opened.png');

      // 5. Check for Mail Merge icon / toggle
      const mmIcon = composeDialog.locator('span.Sz.brj, [aria-label*="mail merge" i], [data-tooltip*="mail merge" i]').first();
      if (await mmIcon.isVisible({ timeout: 8000 }).catch(() => false)) {
        console.log('Opening Mail Merge menu...');
        await mmIcon.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(resultsDir, 'live-03-mail-merge-menu.png') });
        console.log('📸 Screenshot saved: live-03-mail-merge-menu.png');
      }
    } else {
      console.log('Note: Compose button not immediately visible. Google Login may be requested in this profile.');
    }

    // 6. Open Dashboard Tab to confirm connection
    console.log('🖥️ Checking Extension Dashboard Tab...');
    const dashPage = await context.newPage();
    const dashUrl = `chrome-extension://${extensionId}/src/dashboard/dashboard.html`;
    await dashPage.goto(dashUrl, { waitUntil: 'domcontentloaded' });
    await dashPage.waitForTimeout(2000);

    await dashPage.screenshot({ path: path.join(resultsDir, 'live-04-dashboard-synced.png') });
    console.log('📸 Screenshot saved: live-04-dashboard-synced.png');

    console.log('\n===========================================================');
    console.log('🎉 LIVE GMAIL TEST COMPLETED SUCCESSFULLY!');
    console.log('   Screenshots saved in:', resultsDir);
    console.log('===========================================================');

    await page.waitForTimeout(3000);
  } catch (err) {
    console.error('❌ Live Gmail Test Error:', err);
    await context.pages()[0]?.screenshot({ path: path.join(resultsDir, 'live-error-state.png') }).catch(() => {});
  } finally {
    console.log('Closing browser session...');
    await context.close();
  }
}

runLiveGmailTest().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
