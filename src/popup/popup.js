/**
 * Popup Script for Gmail Mail Merge & Scheduler
 * Interacts directly with IDBStore and coordinates with Background Service Worker
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const schedulerToggle = document.getElementById('schedulerToggle');
  const schedulerStateLabel = document.getElementById('schedulerStateLabel');
  const countQueued = document.getElementById('countQueued');
  const countProcessing = document.getElementById('countProcessing');
  const countCompleted = document.getElementById('countCompleted');
  const queueBadgeCount = document.getElementById('queueBadgeCount');
  const nextPollTime = document.getElementById('nextPollTime');
  const campaignsList = document.getElementById('campaignsList');
  const emptyState = document.getElementById('emptyState');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const btnRefresh = document.getElementById('btnRefresh');
  const toast = document.getElementById('toast');

  let isRefreshing = false;

  // Initialize and load UI
  await initDB();
  await loadState();

  // Event Listeners
  schedulerToggle.addEventListener('change', handleSchedulerToggle);
  btnRefresh.addEventListener('click', handleManualRefresh);
  btnOpenDashboard.addEventListener('click', openFullDashboard);

  /**
   * Initializes IDBStore safely
   */
  async function initDB() {
    try {
      if (window.IDBStore) {
        await window.IDBStore.init();
      }
    } catch (err) {
      console.warn('[Popup] IDBStore init issue:', err);
    }
  }

  /**
   * Loads full state from service worker and IndexedDB
   */
  async function loadState() {
    await Promise.all([
      updateSchedulerStatus(),
      loadCampaigns()
    ]);
  }

  /**
   * Queries the background worker or chrome.alarms for scheduler health
   */
  async function updateSchedulerStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SCHEDULER_STATUS' });
      if (response && response.success && response.status) {
        const { alarmActive, nextScheduledPoll } = response.status;
        applySchedulerUI(alarmActive, nextScheduledPoll);
        return;
      }
    } catch (err) {
      console.warn('[Popup] Could not reach background service worker via message, checking chrome.alarms:', err);
    }

    // Fallback: check chrome.alarms directly
    try {
      const alarm = await chrome.alarms.get('POLL_CAMPAIGNS_ALARM');
      applySchedulerUI(!!alarm, alarm ? new Date(alarm.scheduledTime).toISOString() : null);
    } catch (alarmErr) {
      console.error('[Popup] Failed to inspect alarms:', alarmErr);
      applySchedulerUI(false, null);
    }
  }

  /**
   * Updates scheduler toggles, dots, and labels
   */
  function applySchedulerUI(isActive, nextPoll) {
    schedulerToggle.checked = isActive;
    if (isActive) {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Active';
      schedulerStateLabel.textContent = 'Active & Polling (1m)';
      if (nextPoll) {
        const diffMs = new Date(nextPoll).getTime() - Date.now();
        const diffSec = Math.max(0, Math.round(diffMs / 1000));
        nextPollTime.textContent = diffSec > 0 ? `Next poll: ~${diffSec}s` : 'Polling shortly';
      } else {
        nextPollTime.textContent = '';
      }
    } else {
      statusDot.className = 'status-dot paused';
      statusText.textContent = 'Paused';
      schedulerStateLabel.textContent = 'Scheduler Paused';
      nextPollTime.textContent = 'Polling disabled';
    }
  }

  /**
   * Toggles the background scheduler
   */
  async function handleSchedulerToggle() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'TOGGLE_SCHEDULER' });
      if (response && response.success) {
        applySchedulerUI(response.active, null);
        showToast(response.active ? 'Scheduler activated' : 'Scheduler paused');
      } else {
        // Toggle locally via alarms fallback
        const isCurrentlyChecked = schedulerToggle.checked;
        if (isCurrentlyChecked) {
          await chrome.alarms.create('POLL_CAMPAIGNS_ALARM', { periodInMinutes: 1 });
          applySchedulerUI(true, null);
          showToast('Scheduler activated');
        } else {
          await chrome.alarms.clear('POLL_CAMPAIGNS_ALARM');
          applySchedulerUI(false, null);
          showToast('Scheduler paused');
        }
      }
    } catch (err) {
      console.error('[Popup] Error toggling scheduler:', err);
      showToast('Failed to toggle scheduler');
      await updateSchedulerStatus();
    }
  }

  /**
   * Loads campaigns from IDBStore and populates metrics & queue list
   */
  async function loadCampaigns() {
    try {
      let campaigns = [];
      if (window.IDBStore) {
        campaigns = await window.IDBStore.getCampaigns();
      }

      // Compute counts
      const queued = campaigns.filter(c => c.status === 'QUEUED');
      const processing = campaigns.filter(c => c.status === 'PROCESSING');
      const completed = campaigns.filter(c => c.status === 'COMPLETED');

      countQueued.textContent = queued.length;
      countProcessing.textContent = processing.length;
      countCompleted.textContent = completed.length;

      // Pending campaigns include QUEUED and PROCESSING
      const pending = campaigns.filter(c => c.status === 'QUEUED' || c.status === 'PROCESSING');
      queueBadgeCount.textContent = pending.length;

      renderPendingCampaigns(pending);
    } catch (err) {
      console.error('[Popup] Error loading campaigns:', err);
      showToast('Error loading database');
    }
  }

  /**
   * Renders pending campaigns cards or displays empty state
   */
  function renderPendingCampaigns(pending) {
    // Clear existing campaign cards (preserving or toggling emptyState)
    campaignsList.innerHTML = '';

    if (!pending || pending.length === 0) {
      campaignsList.appendChild(emptyState);
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    pending.forEach(campaign => {
      const card = document.createElement('div');
      card.className = 'campaign-card';
      card.dataset.id = campaign.id;

      const isQueued = campaign.status === 'QUEUED';
      const statusClass = isQueued ? 'status-queued' : 'status-processing';
      const statusLabel = isQueued ? 'Queued' : 'Processing';

      // Format schedule or due time
      const timeStr = formatScheduledTime(campaign.scheduledAt);
      const sheetName = campaign.spreadsheetTitle || extractSheetName(campaign.spreadsheetUrl) || 'Google Sheet';
      const subjectText = campaign.subject || 'Untitled Campaign';

      card.innerHTML = `
        <div class="campaign-top">
          <div class="campaign-subject" title="${escapeHtml(subjectText)}">
            ${escapeHtml(subjectText)}
          </div>
          <span class="campaign-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="campaign-meta">
          <div class="sheet-title" title="${escapeHtml(sheetName)}">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <span>${escapeHtml(sheetName)}</span>
          </div>
          <span class="scheduled-time" title="Scheduled execution">${timeStr}</span>
        </div>
        <div class="campaign-actions">
          <button class="btn-action btn-run" data-action="run" data-id="${campaign.id}" title="Trigger immediately">
            ▶ Run Now
          </button>
          <button class="btn-action btn-cancel" data-action="cancel" data-id="${campaign.id}" title="Cancel campaign">
            ✕ Cancel
          </button>
        </div>
      `;

      // Attach button events
      const btnRun = card.querySelector('[data-action="run"]');
      const btnCancel = card.querySelector('[data-action="cancel"]');

      btnRun.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerRunNow(campaign.id);
      });

      btnCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelCampaign(campaign.id);
      });

      campaignsList.appendChild(card);
    });
  }

  /**
   * Triggers a campaign immediately via background worker
   */
  async function triggerRunNow(campaignId) {
    try {
      showToast('Dispatched campaign...');
      const response = await chrome.runtime.sendMessage({
        action: 'TRIGGER_CAMPAIGN_NOW',
        campaignId
      });

      if (response && response.success) {
        showToast('Campaign execution started');
      } else {
        showToast(response?.error || 'Execution triggered');
      }

      await loadCampaigns();
    } catch (err) {
      console.error('[Popup] Trigger campaign failed:', err);
      showToast('Trigger failed: ' + err.message);
    }
  }

  /**
   * Cancels/deletes a campaign from queue
   */
  async function cancelCampaign(campaignId) {
    try {
      if (window.IDBStore) {
        // Update status to CANCELLED or delete
        await window.IDBStore.updateCampaign(campaignId, {
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString()
        });
        await window.IDBStore.addLog(campaignId, 'WARN', 'Campaign cancelled by user in popup.');
      }

      // Notify background to refresh badge
      try {
        await chrome.runtime.sendMessage({ action: 'REFRESH_BADGE' });
      } catch (e) {
        // Ignore if background asleep
      }

      showToast('Campaign cancelled');
      await loadCampaigns();
    } catch (err) {
      console.error('[Popup] Cancel campaign error:', err);
      showToast('Failed to cancel campaign');
    }
  }

  /**
   * Opens the full dashboard in a new tab
   */
  async function openFullDashboard() {
    try {
      await chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      window.close();
    } catch (err) {
      // Fallback
      const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
      await chrome.tabs.create({ url });
      window.close();
    }
  }

  /**
   * Manual refresh button with animation
   */
  async function handleManualRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    btnRefresh.classList.add('spinning');

    try {
      await loadState();
      showToast('Queue refreshed');
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => {
        btnRefresh.classList.remove('spinning');
        isRefreshing = false;
      }, 500);
    }
  }

  /**
   * Shows transient toast message
   */
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  /**
   * Formats scheduled time relative or concise
   */
  function formatScheduledTime(dateStr) {
    if (!dateStr) return '⚡ Immediate';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '⚡ Immediate';

    const now = Date.now();
    const diffMs = d.getTime() - now;

    if (diffMs <= 0) {
      return '⏱ Due now';
    }

    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60) {
      return `In ${diffMins}m`;
    }

    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) {
      return `In ${diffHours}h`;
    }

    // Format as 'Sep 4, 18:30'
    const month = d.toLocaleString('en', { month: 'short' });
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${month} ${day}, ${hours}:${mins}`;
  }

  /**
   * Extracts sheet name or ID from URL
   */
  function extractSheetName(url) {
    if (!url) return '';
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      return 'Sheet ' + match[1].substring(0, 8) + '...';
    }
    return '';
  }

  /**
   * Opens the full management dashboard in a new tab or focuses existing
   */
  async function openFullDashboard() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      if (!response || !response.success) {
        const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
        await chrome.tabs.create({ url: dashboardUrl });
      }
    } catch (err) {
      console.warn('[Popup] Error via sendMessage, opening dashboard via tabs API:', err);
      const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
      await chrome.tabs.create({ url: dashboardUrl });
    }
  }

  /**
   * Escapes unsafe HTML characters
   */
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
