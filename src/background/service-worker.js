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

// Tracks active campaign execution tabs: campaignId -> { tabId, timeoutId }
const activeCampaignTabs = new Map();

// Tracks actively executing accounts: accountKey -> { campaignId, timeoutId, startedAt }
const executingAccounts = new Map();

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

    const now = Date.now();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const readyCampaigns = [];

    for (const camp of dueCampaigns) {
      if (camp.scheduledAt) {
        const schedTime = new Date(camp.scheduledAt).getTime();
        // Ponytail: Auto-execute overdue campaigns regardless of sleep/wake delay per user policy
        if (now - schedTime > FIVE_MINUTES_MS) {
          const overdueMinutes = Math.round((now - schedTime) / 60000);
          console.log(`[ServiceWorker] Campaign ${camp.id} was scheduled for ${camp.scheduledAt} (${overdueMinutes}m ago). Executing now after wake-up.`);
          await self.IDBStore.addLog(
            camp.id,
            'INFO',
            `Executing overdue campaign (scheduled for ${new Date(schedTime).toLocaleTimeString()}, ${overdueMinutes}m late due to PC sleep/interval).`
          );
        }
      }
      readyCampaigns.push(camp);
    }

    if (readyCampaigns.length === 0) {
      await refreshBadge();
      return;
    }

    console.log(`[ServiceWorker] Found ${readyCampaigns.length} ready due campaign(s). Grouping by account...`);

    // Group due campaigns strictly by account email (or userIndex fallback)
    const accountGroups = {};
    for (const campaign of readyCampaigns) {
      const key = (campaign.accountEmail || '').toLowerCase().trim() || String(campaign.userIndex !== undefined ? campaign.userIndex : '0');
      if (!accountGroups[key]) accountGroups[key] = [];
      accountGroups[key].push(campaign);
    }

    // Run accounts in parallel; execute campaigns within the same account sequentially
    await Promise.all(
      Object.values(accountGroups).map(async (campaignsForAccount) => {
        const sorted = campaignsForAccount.sort(
          (a, b) => new Date(a.scheduledAt || a.createdAt || 0) - new Date(b.scheduledAt || b.createdAt || 0)
        );
        if (sorted.length > 0) {
          await executeCampaign(sorted[0]);
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
  let createdBackgroundTabId = null;
  const accountKey = (campaign.accountEmail || '').toLowerCase().trim() || String(campaign.userIndex !== undefined ? campaign.userIndex : '0');

  // Concurrency guard: Do not run two campaigns for the same account simultaneously
  if (executingAccounts.has(accountKey)) {
    console.log(`[ServiceWorker] ⏳ Account "${accountKey}" is currently executing another campaign. Campaign "${campaign.id}" remains QUEUED in line.`);
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

  const timeoutId = setTimeout(() => {
    console.warn(`[ServiceWorker] Safety timeout (6 min) reached for account ${accountKey} on campaign ${campaign.id}. Releasing lock.`);
    releaseAccountLock(accountKey, campaign.id).catch(() => {});
  }, 6 * 60 * 1000);

  executingAccounts.set(accountKey, {
    campaignId: campaign.id,
    timeoutId,
    startedAt: Date.now()
  });

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
      `Scheduler initiated campaign "${campaign.name || campaign.subject || campaign.id}".`
    );

    // 3. Prioritize reusing an existing open Gmail tab!
    let targetTab = await findGmailTab(campaign);

    if (!targetTab) {
      // Only open a new tab as fallback if NO Gmail tab is open
      const baseUrl = campaign.accountUrl || (campaign.userIndex !== undefined ? `https://mail.google.com/mail/u/${campaign.userIndex}/` : 'https://mail.google.com/mail/u/0/');
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');
      const targetUrl = (campaign.draftId && campaign.draftId !== 'unknown')
        ? `${cleanBaseUrl}/#drafts?compose=${campaign.draftId}`
        : `${cleanBaseUrl}/#drafts`;

      console.log(`[ServiceWorker] 🛡️ No open Gmail tab found. Opening dedicated tab for campaign ${campaign.id}: ${targetUrl}`);
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
      console.log(`[ServiceWorker] ⚡ Reusing existing open Gmail tab ${targetTab.id} for campaign ${campaign.id}`);
    }

    // Ensure the Chrome window containing this tab is NOT minimized (prevents Windows 11 EcoQoS timer clamping)
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
      console.log(`[ServiceWorker] Dispatched campaign ${campaign.id} to tab ${targetTab.id} (ACK received). Execution running in tab.`);
      // Only auto-close if WE created this dedicated tab; NEVER close user's existing tab
      if (createdBackgroundTabId) {
        activeCampaignTabs.set(campaign.id, {
          tabId: createdBackgroundTabId,
          timeoutId: setTimeout(() => {
            console.warn(`[ServiceWorker] Campaign ${campaign.id} safety timeout (5 min). Closing tab ${createdBackgroundTabId}.`);
            chrome.tabs.remove(createdBackgroundTabId).catch(() => {});
            activeCampaignTabs.delete(campaign.id);
          }, 5 * 60 * 1000)
        });
      }
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

    await self.IDBStore.updateCampaign(campaign.id, {
      status: 'FAILED',
      errorMessage: err.message,
      failedAt: new Date().toISOString()
    });
    await self.IDBStore.addLog(campaign.id, 'ERROR', `Execution trigger error: ${err.message}`);

    // If Daily Sending Limit was reached, pause remaining campaigns for 12 hours
    if (err.message && err.message.includes('Daily Sending Limit')) {
      await pauseAccountCampaignsForQuota(campaign.accountEmail);
    }

    notifyDesktop(
      '❌ Mail Merge Error',
      `Failed to send "${campaign.subject || 'Campaign'}": ${err.message}`,
      true
    );

    // Free lock on setup failure so subsequent queued campaigns can run
    await releaseAccountLock(accountKey, campaign.id);
  }
}

/**
 * Releases the execution lock for an account and triggers the next queued campaign in FIFO order.
 * @param {string} accountKey
 * @param {string} [campaignId]
 */
async function releaseAccountLock(accountKey, campaignId) {
  if (!accountKey) return;
  const lock = executingAccounts.get(accountKey);
  if (lock) {
    if (campaignId && lock.campaignId && lock.campaignId !== campaignId) {
      return;
    }
    if (lock.timeoutId) clearTimeout(lock.timeoutId);
    executingAccounts.delete(accountKey);
    console.log(`[ServiceWorker] 🔓 Released execution lock for account "${accountKey}".`);
  }

  // 3.5s buffer for Gmail tab to close and DOM to settle cleanly
  setTimeout(async () => {
    await processNextQueuedCampaign(accountKey);
  }, 3500);
}

/**
 * Finds and executes the next queued campaign for a given account.
 * @param {string} accountKey
 */
async function processNextQueuedCampaign(accountKey) {
  if (!self.IDBStore) return;
  if (executingAccounts.has(accountKey)) return;

  try {
    const campaigns = await self.IDBStore.getCampaigns();
    const queuedForAccount = campaigns
      .filter((c) => {
        if (c.status !== 'QUEUED') return false;
        const key = (c.accountEmail || '').toLowerCase().trim() || String(c.userIndex !== undefined ? c.userIndex : '0');
        return key === accountKey;
      })
      .sort((a, b) => new Date(a.scheduledAt || a.createdAt || 0) - new Date(b.scheduledAt || b.createdAt || 0));

    if (queuedForAccount.length > 0) {
      const nextCamp = queuedForAccount[0];
      console.log(`[ServiceWorker] ⏩ Processing next queued campaign for account "${accountKey}": ${nextCamp.id} ("${nextCamp.subject || 'Untitled'}")`);
      await executeCampaign(nextCamp);
    } else {
      console.log(`[ServiceWorker] 🏁 Queue drained for account "${accountKey}". All queued campaigns finished.`);
      await refreshBadge();
    }
  } catch (err) {
    console.error(`[ServiceWorker] Error processing next queued campaign for ${accountKey}:`, err);
  }
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
 * Finds the most suitable open Gmail tab, prioritizing the account the campaign was scheduled in.
 * @param {Object} [campaign]
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findGmailTab(campaign) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (!tabs || tabs.length === 0) {
    return null;
  }

  // Ensure all Gmail tabs are protected from Chrome Memory Saver
  for (const t of tabs) {
    chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
  }

  const targetEmail = (campaign?.accountEmail || '').toLowerCase().trim();
  let matchedTab = null;

  // 1. Highest Priority: Match by actual logged-in email in pinned tabs!
  if (targetEmail) {
    for (const t of tabs) {
      try {
        const info = await chrome.tabs.sendMessage(t.id, { action: 'GET_TAB_ACCOUNT_INFO' }).catch(() => null);
        if (info && info.email && info.email.toLowerCase() === targetEmail) {
          matchedTab = t;
          break;
        }
      } catch (_) {}
    }
  }

  // Determine target account path (/mail/u/0/, /mail/u/1/, etc.) if known
  if (!matchedTab) {
    let targetPath = null;
    if (campaign) {
      if (campaign.accountUrl) {
        const match = campaign.accountUrl.match(/\/mail\/u\/(\d+)/);
        if (match) targetPath = `/mail/u/${match[1]}/`;
      }
      if (!targetPath && campaign.userIndex !== undefined) {
        targetPath = `/mail/u/${campaign.userIndex}/`;
      }
    }

    // 2. If active tab matches target account (or no specific account required), use active tab immediately!
    const activeTab = tabs.find((t) => t.active);
    if (activeTab && (!targetPath || (activeTab.url && activeTab.url.includes(targetPath)))) {
      matchedTab = activeTab;
    } else if (targetPath) {
      matchedTab = tabs.find((t) => t.url && t.url.includes(targetPath));
    } else {
      matchedTab = activeTab || tabs[0];
    }
  }

  // Check if tab was discarded by Chrome Memory Saver
  if (matchedTab && matchedTab.discarded) {
    console.log(`[ServiceWorker] 💤 Gmail tab ${matchedTab.id} was discarded by Chrome. Hard reloading (bypassCache)...`);
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
        if (executingAccounts.has(accountKey)) {
          await refreshBadge();
          return { success: true, queued: true, message: `Campaign queued in line for account #${campaign.userIndex || '0'}.` };
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
        await self.IDBStore.updateCampaign(message.campaignId, {
          status: message.status,
          sentCount: message.sentCount !== undefined ? message.sentCount : undefined,
          recipientCount: message.recipientCount !== undefined ? message.recipientCount : undefined,
          failedCount: message.failedCount !== undefined ? message.failedCount : undefined,
          errorMessage: message.status === 'FAILED' ? (message.logMessage || message.error) : undefined,
          errorCategory: message.errorCategory || undefined,
          canAutoRetry: message.canAutoRetry !== undefined ? message.canAutoRetry : undefined,
          completedAt: (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)') ? new Date().toISOString() : undefined
        });
        if (message.logMessage) {
          await self.IDBStore.addLog(
            message.campaignId,
            message.logLevel || (message.status === 'FAILED' ? 'ERROR' : 'INFO'),
            message.logMessage
          );
        }
        await refreshBadge();

        // Clean Auto-Close: close the dedicated execution tab on completion or failure
        const activeTabInfo = activeCampaignTabs.get(message.campaignId);
        if (activeTabInfo && (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)' || message.status === 'FAILED')) {
          if (activeTabInfo.timeoutId) clearTimeout(activeTabInfo.timeoutId);
          setTimeout(() => {
            chrome.tabs.remove(activeTabInfo.tabId).catch(() => {});
          }, 3000);
          activeCampaignTabs.delete(message.campaignId);
        }

        // Release account execution lock and trigger next queued campaign for this account
        if (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)' || message.status === 'FAILED') {
          const camp = await self.IDBStore.getCampaignById(message.campaignId).catch(() => null);
          const accountKey = (camp?.accountEmail || message.accountEmail || '').toLowerCase().trim() || String(camp?.userIndex !== undefined ? camp.userIndex : '0');
          releaseAccountLock(accountKey, message.campaignId).catch(() => {});
        }

        if (message.status === 'COMPLETED' || message.status === 'COMPLETED (DRY RUN)') {
          notifyDesktop(
            '✅ Mail Merge Completed',
            `Campaign sent${message.sentCount ? ' to ' + message.sentCount + ' recipients' : ''}.`
          );
        } else if (message.status === 'FAILED') {
          if (message.isQuotaLimit || (message.logMessage && message.logMessage.includes('Daily Sending Limit'))) {
            pauseAccountCampaignsForQuota(message.accountEmail);
          }
          notifyDesktop(
            '❌ Mail Merge Error',
            `Campaign failed: ${message.logMessage || 'Execution failed'}`,
            true
          );
        }

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
        if (executingAccounts.has(accountKey)) {
          await refreshBadge();
          return { success: true, mode: 'queued', message: `Campaign queued in line for account #${campaign.userIndex || '0'}.` };
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
