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

// =============================================================================
// LIFECYCLE & ALARM MANAGEMENT
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[ServiceWorker] Extension installed/updated. Reason: ${details.reason}`);
  await setupPollingAlarm();
  await refreshBadge();
  await injectIntoExistingGmailTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[ServiceWorker] Extension starting up.');
  await setupPollingAlarm();
  await refreshBadge();
  await injectIntoExistingGmailTabs();
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
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'src/db/idb-store.js',
            'src/content/gmail-automator.js',
            'src/content/compose-injector.js',
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
 * Creates the periodic alarm if it does not already exist.
 */
async function setupPollingAlarm() {
  try {
    const existingAlarm = await chrome.alarms.get(ALARM_NAME);
    if (!existingAlarm) {
      chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: POLL_INTERVAL_MINUTES
      });
      console.log(`[ServiceWorker] Periodic alarm "${ALARM_NAME}" created with interval ${POLL_INTERVAL_MINUTES} min.`);
    }
  } catch (err) {
    console.error('[ServiceWorker] Error creating alarm:', err);
  }
}

// Immediate top-level initialization
setupPollingAlarm().catch(() => {});
refreshBadge().catch(() => {});
injectIntoExistingGmailTabs().catch(() => {});

// Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log("[ServiceWorker] Alarm triggered: " + alarm.name);
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

// =============================================================================
// CAMPAIGN EXECUTION & GMAIL TAB COMMUNICATION
// =============================================================================

/**
 * Checks for due campaigns in IndexedDB and triggers execution via Gmail content script.
 * Ponytail: groups by account so different accounts run parallel while same account runs sequential.
 */
async function checkAndExecuteDueCampaigns() {
  try {
    if (!self.IDBStore) {
      console.error('[ServiceWorker] IDBStore is not available.');
      return;
    }

    const dueCampaigns = await self.IDBStore.getDueCampaigns();
    if (!dueCampaigns || dueCampaigns.length === 0) {
      console.log('[ServiceWorker] No due campaigns found.');
      await refreshBadge();
      return;
    }

    console.log(`[ServiceWorker] Found ${dueCampaigns.length} due campaign(s). Grouping by account...`);

    // Group due campaigns by account index
    const accountGroups = {};
    for (const campaign of dueCampaigns) {
      const key = campaign.userIndex || '0';
      if (!accountGroups[key]) accountGroups[key] = [];
      accountGroups[key].push(campaign);
    }

    // Run accounts in parallel; execute campaigns within the same account sequentially
    await Promise.all(
      Object.values(accountGroups).map(async (campaignsForAccount) => {
        for (const camp of campaignsForAccount) {
          await executeCampaign(camp);
        }
      })
    );

    await refreshBadge();
  } catch (err) {
    console.error('[ServiceWorker] Error checking due campaigns:', err);
    if (self.IDBStore) {
      await self.IDBStore.addLog(null, 'ERROR', `Scheduler check failed: ${err.message}`);
    }
  }
}

/**
 * Finds or opens a Gmail tab and transmits the EXECUTE_CAMPAIGN action.
 * @param {Object} campaign
 */
async function executeCampaign(campaign) {
  try {
    // 1. Update status to PROCESSING immediately
    await self.IDBStore.updateCampaign(campaign.id, {
      status: 'PROCESSING',
      startedAt: new Date().toISOString()
    });

    await self.IDBStore.addLog(
      campaign.id,
      'INFO',
      `Scheduler initiated campaign "${campaign.name || campaign.subject || campaign.id}".`
    );

    // 2. Find an existing Gmail tab matching the account
    let gmailTab = await findGmailTab(campaign);

    // 3. If no Gmail tab exists, open one in background for the specific account
    if (!gmailTab) {
      const targetUrl = (campaign && campaign.accountUrl)
        ? campaign.accountUrl
        : ((campaign && campaign.userIndex !== undefined) ? `https://mail.google.com/mail/u/${campaign.userIndex}/` : 'https://mail.google.com/');
      console.log(`[ServiceWorker] No Gmail tab found for account. Creating background tab for ${targetUrl}...`);
      gmailTab = await chrome.tabs.create({
        url: targetUrl,
        active: false
      });

      await waitForTabComplete(gmailTab.id);
      await delay(2500);
    }

    // 4. Send message to content script and await execution result
    const sent = await sendMessageWithRetry(gmailTab.id, {
      action: 'EXECUTE_CAMPAIGN',
      campaign
    });

    if (sent) {
      console.log(`[ServiceWorker] Dispatched campaign ${campaign.id} to tab ${gmailTab.id}`);
      // Show desktop notification on successful dispatch/completion
      notifyDesktop(
        '✅ Mail Merge Completed',
        `"${campaign.subject || 'Campaign'}" sent${campaign.recipientCount ? ' to ' + campaign.recipientCount + ' recipients' : ''}.`
      );
    } else {
      throw new Error(`Failed to deliver EXECUTE_CAMPAIGN message to Gmail tab ${gmailTab.id}`);
    }
  } catch (err) {
    console.error(`[ServiceWorker] Failed to execute campaign ${campaign.id}:`, err);
    await self.IDBStore.updateCampaign(campaign.id, {
      status: 'FAILED',
      errorMessage: err.message,
      failedAt: new Date().toISOString()
    });
    await self.IDBStore.addLog(campaign.id, 'ERROR', `Execution trigger error: ${err.message}`);

    notifyDesktop(
      '❌ Mail Merge Error',
      `Failed to send "${campaign.subject || 'Campaign'}": ${err.message}`,
      true
    );
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
 * Finds the most suitable open Gmail tab, prioritizing the account the campaign was scheduled in.
 * @param {Object} [campaign]
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findGmailTab(campaign) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (!tabs || tabs.length === 0) {
    return null;
  }

  // 1. If campaign specifies a user index (/u/0/, /u/1/, etc.), find that exact account tab
  if (campaign && campaign.userIndex !== undefined) {
    const targetPath = `/mail/u/${campaign.userIndex}/`;
    const accountTab = tabs.find((t) => t.url && t.url.includes(targetPath));
    if (accountTab) {
      return accountTab;
    }
  }

  // 2. Fallback: Prefer active tab if one of them is active
  const activeTab = tabs.find((t) => t.active);
  return activeTab || tabs[0];
}

/**
 * Waits for a newly opened tab to finish loading.
 * @param {number} tabId
 * @param {number} timeoutMs
 */
function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let timer = null;

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (timer) clearTimeout(timer);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Dispatches a message to a tab with retry logic in case the content script is still mounting.
 * @param {number} tabId
 * @param {Object} message
 * @param {number} maxRetries
 */
async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response || true;
    } catch (err) {
      console.warn(`[ServiceWorker] Message dispatch attempt ${attempt} to tab ${tabId} failed:`, err.message);

      // If receiving end does not exist (tab not refreshed), dynamically inject content scripts
      if (err.message && err.message.includes('Receiving end does not exist') && chrome.scripting) {
        try {
          console.log(`[ServiceWorker] Dynamically injecting content scripts into tab ${tabId}...`);
          await chrome.scripting.executeScript({
            target: { tabId },
            files: [
              'src/db/idb-store.js',
              'src/content/gmail-automator.js',
              'src/content/compose-injector.js',
              'src/content/content.js'
            ]
          });
          await delay(1000);
        } catch (injectErr) {
          console.warn('[ServiceWorker] Dynamic script injection failed:', injectErr.message);
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
        await executeCampaign(campaign);
        await refreshBadge();
        return { success: true, message: `Campaign "${campaign.id}" triggered.` };
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

    case 'OPEN_DASHBOARD': {
      const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
      const tabs = await chrome.tabs.query({ url: dashboardUrl });

      if (tabs && tabs.length > 0) {
        // Switch to the existing dashboard tab
        await chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId) {
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        }
        return { success: true, tabId: tabs[0].id, existing: true };
      } else {
        // Create new tab
        const newTab = await chrome.tabs.create({ url: dashboardUrl });
        return { success: true, tabId: newTab.id, existing: false };
      }
    }

    case 'CAMPAIGN_STATUS_UPDATE': {
      // Content script reporting completion or progress
      if (message.campaignId && message.status) {
        await self.IDBStore.updateCampaign(message.campaignId, {
          status: message.status,
          sentCount: message.sentCount !== undefined ? message.sentCount : undefined,
          failedCount: message.failedCount !== undefined ? message.failedCount : undefined,
          completedAt: (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)') ? new Date().toISOString() : undefined
        });
        if (message.logMessage) {
          await self.IDBStore.addLog(
            message.campaignId,
            message.logLevel || 'INFO',
            message.logMessage
          );
        }
        await refreshBadge();
        return { success: true };
      }
      return { success: false, error: 'Missing campaignId or status' };
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
