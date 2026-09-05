/**
 * All-in-One Popup Script for Gmail Native Mail Merge & Scheduler
 * Provides complete campaign browsing, status filtering, multi-account awareness, and direct controls.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Header & Filter
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const schedulerToggle = document.getElementById('schedulerToggle');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const campaignsList = document.getElementById('campaignsList');
  const emptyState = document.getElementById('emptyState');
  const toast = document.getElementById('toast');

  // Filter counts
  const countAll = document.getElementById('countAll');
  const countQueued = document.getElementById('countQueued');
  const countCompleted = document.getElementById('countCompleted');
  const countFailed = document.getElementById('countFailed');
  const filterPills = document.querySelectorAll('.filter-pill');

  // State
  let allCampaigns = [];
  let currentFilter = 'ALL';
  let isRefreshing = false;

  // Initialize
  await initDB();
  setupEventListeners();
  await loadState();

  function setupEventListeners() {
    schedulerToggle.addEventListener('change', handleSchedulerToggle);
    btnRefresh.addEventListener('click', handleManualRefresh);
    if (btnOpenDashboard) {
      btnOpenDashboard.addEventListener('click', openFullDashboard);
    }

    // Filter pill tabs
    filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentFilter = pill.dataset.filter || 'ALL';
        renderCampaigns();
      });
    });
  }

  /**
   * Initializes IDBStore safely
   */
  async function initDB() {
    try {
      if (window.IDBStore) {
        await window.IDBStore.init();
      }
    } catch (err) {
      console.warn('[Popup] IDBStore init note:', err);
    }
  }

  /**
   * Loads full state from background worker and IndexedDB
   */
  async function loadState() {
    // 1. Sync from open Gmail tabs so any recent draft appears immediately
    await syncFromGmailTabs();

    // 2. Query campaigns and scheduler status
    await Promise.all([
      updateSchedulerStatus(),
      loadCampaigns()
    ]);
  }

  /**
   * Requests any open Gmail tabs to sync their local campaigns to background
   */
  async function syncFromGmailTabs() {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        for (const t of gmailTabs) {
          chrome.tabs.sendMessage(t.id, { action: 'REQUEST_CAMPAIGN_SYNC' }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  /**
   * Updates scheduler toggle & status indicator
   */
  async function updateSchedulerStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SCHEDULER_STATUS' });
      if (response && response.success && response.status) {
        const { alarmActive } = response.status;
        applySchedulerUI(alarmActive);
        return;
      }
    } catch (_) {}

    // Fallback: direct alarm check
    try {
      const alarm = await chrome.alarms.get('POLL_CAMPAIGNS_ALARM');
      applySchedulerUI(!!alarm);
    } catch (_) {
      applySchedulerUI(true);
    }
  }

  function applySchedulerUI(isActive) {
    schedulerToggle.checked = isActive;
    if (isActive) {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Scheduler Active';
    } else {
      statusDot.className = 'status-dot paused';
      statusText.textContent = 'Scheduler Paused';
    }
  }

  /**
   * Loads all campaigns from IndexedDB
   */
  async function loadCampaigns() {
    try {
      if (window.IDBStore) {
        allCampaigns = await window.IDBStore.getCampaigns();
      } else {
        allCampaigns = [];
      }

      updateCounts();
      renderCampaigns();
    } catch (err) {
      console.error('[Popup] Error loading campaigns:', err);
      showToast('Error loading campaigns');
    }
  }

  /**
   * Updates the count badges on filter pills
   */
  function updateCounts() {
    const counts = {
      ALL: allCampaigns.length,
      QUEUED: 0,
      COMPLETED: 0,
      FAILED: 0
    };

    allCampaigns.forEach((c) => {
      if (c.status === 'QUEUED' || c.status === 'PROCESSING') {
        counts.QUEUED++;
      } else if (c.status === 'COMPLETED') {
        counts.COMPLETED++;
      } else if (c.status === 'FAILED') {
        counts.FAILED++;
      }
    });

    countAll.textContent = String(counts.ALL);
    countQueued.textContent = String(counts.QUEUED);
    countCompleted.textContent = String(counts.COMPLETED);
    countFailed.textContent = String(counts.FAILED);
  }

  /**
   * Renders campaign cards based on the selected filter
   */
  function renderCampaigns() {
    campaignsList.innerHTML = '';

    let filtered = allCampaigns;
    if (currentFilter === 'QUEUED') {
      filtered = allCampaigns.filter((c) => c.status === 'QUEUED' || c.status === 'PROCESSING');
    } else if (currentFilter === 'COMPLETED') {
      filtered = allCampaigns.filter((c) => c.status === 'COMPLETED');
    } else if (currentFilter === 'FAILED') {
      filtered = allCampaigns.filter((c) => c.status === 'FAILED' || c.status === 'CANCELLED');
    }

    if (!filtered || filtered.length === 0) {
      campaignsList.appendChild(emptyState);
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    filtered.forEach((camp) => {
      const card = document.createElement('div');
      card.className = 'campaign-card';
      card.dataset.id = camp.id;

      // Status Class & Label
      let statusClass = 'status-queued';
      let statusLabel = 'Queued';
      if (camp.status === 'PROCESSING') {
        statusClass = 'status-processing';
        statusLabel = 'Processing';
      } else if (camp.status === 'COMPLETED') {
        statusClass = 'status-completed';
        statusLabel = '✓ Completed';
      } else if (camp.status === 'FAILED') {
        statusClass = 'status-failed';
        statusLabel = '✕ Failed';
      } else if (camp.status === 'CANCELLED') {
        statusClass = 'status-cancelled';
        statusLabel = 'Cancelled';
      }

      // Sender Account
      const accountLabel = camp.accountEmail
        ? camp.accountEmail
        : (camp.userIndex && camp.userIndex !== '0' ? 'Gmail Account #' + camp.userIndex : 'Gmail Primary');

      // Time Display & Live Progress
      let timeLabel = '';
      if (camp.status === 'COMPLETED') {
        timeLabel = 'Sent: ' + formatTime(camp.completedAt || camp.updatedAt);
      } else if (camp.status === 'QUEUED') {
        timeLabel = 'Scheduled: ' + formatTime(camp.scheduledAt);
      } else if (camp.status === 'PROCESSING') {
        timeLabel = (camp.progressMessage || 'Executing...') + (camp.progressPct ? ' (' + camp.progressPct + '%)' : '');
      } else if (camp.status === 'FAILED') {
        timeLabel = 'Failed: ' + formatTime(camp.failedAt || camp.updatedAt);
      } else {
        timeLabel = formatTime(camp.updatedAt || camp.createdAt);
      }

      const subject = camp.subject || 'Untitled Subject';

      // Live progress bar HTML for actively running campaign
      const progressBarHtml = (camp.status === 'PROCESSING')
        ? `<div class="progress-bar-wrap">
             <div class="progress-bar-fill" style="width: ${camp.progressPct || 15}%;"></div>
           </div>`
        : '';

      // Metadata Badges (Sheet Link, Audience Count, Merge Tags)
      const sheetBadge = camp.sheetTitle
        ? `<a class="meta-badge badge-sheet" href="${camp.sheetUrl || '#'}" target="_blank" title="${escapeHtml(camp.sheetUrl || camp.sheetTitle)}" onclick="event.stopPropagation();">
             📊 ${escapeHtml(camp.sheetTitle)} ↗
           </a>`
        : '';

      const audienceBadge = camp.recipientCount
        ? `<span class="meta-badge badge-audience">👥 ${camp.recipientCount}</span>`
        : (camp.recipientsSummary ? `<span class="meta-badge badge-audience">👥 ${escapeHtml(camp.recipientsSummary)}</span>` : '');

      const tagsBadge = (camp.mergeTags && camp.mergeTags.length > 0)
        ? `<span class="meta-badge badge-tags" title="Tags: ${escapeHtml(camp.mergeTags.join(', '))}">🏷️ ${camp.mergeTags.length} tags</span>`
        : '';

      const badgesHtml = (sheetBadge || audienceBadge || tagsBadge)
        ? `<div class="campaign-badges">${sheetBadge}${audienceBadge}${tagsBadge}</div>`
        : '';

      // Actions HTML
      let actionsHtml = '';
      if (camp.status === 'QUEUED') {
        actionsHtml = `
          <button class="btn-action btn-run" data-action="run" data-id="${camp.id}" title="Execute immediately">
            ▶ Run Now
          </button>
          <button class="btn-action btn-cancel" data-action="cancel" data-id="${camp.id}" title="Cancel campaign">
            ✕ Cancel
          </button>
        `;
      } else if (camp.status === 'FAILED') {
        actionsHtml = `
          <button class="btn-action btn-run" data-action="run" data-id="${camp.id}" title="Retry execution now">
            ↻ Retry Now
          </button>
          <button class="btn-action btn-delete" data-action="delete" data-id="${camp.id}" title="Remove from list">
            🗑 Delete
          </button>
        `;
      } else {
        actionsHtml = `
          <button class="btn-action btn-delete" data-action="delete" data-id="${camp.id}" title="Remove from list">
            🗑 Delete
          </button>
        `;
      }

      // Error message if failed
      const errorHtml = (camp.status === 'FAILED' && camp.errorMessage)
        ? `<div class="campaign-error" title="${escapeHtml(camp.errorMessage)}">${escapeHtml(camp.errorMessage)}</div>`
        : '';

      // Expandable Details Drawer
      const hasDetails = camp.draftId || (camp.mergeTags && camp.mergeTags.length > 0) || camp.bodySnippet;
      const detailsToggleHtml = hasDetails
        ? `<span class="btn-drawer-toggle" data-toggle="${camp.id}">▸ Details</span>`
        : '';

      const drawerHtml = hasDetails
        ? `<div class="campaign-drawer" id="drawer-${camp.id}" style="display: none;">
             ${camp.draftId ? `<div class="drawer-row"><b>Draft ID:</b> <code>${escapeHtml(camp.draftId.slice(0, 26))}...</code></div>` : ''}
             ${camp.mergeTags && camp.mergeTags.length > 0 ? `<div class="drawer-row"><b>Tags:</b> ${escapeHtml(camp.mergeTags.join(', '))}</div>` : ''}
             ${camp.bodySnippet ? `<div class="drawer-row drawer-snippet"><b>Body:</b> "${escapeHtml(camp.bodySnippet.slice(0, 110))}..."</div>` : ''}
           </div>`
        : '';

      card.innerHTML = `
        <div class="campaign-top">
          <div class="campaign-subject" title="${escapeHtml(subject)}">
            ${escapeHtml(subject)}
          </div>
          <span class="campaign-status ${statusClass}">${statusLabel}</span>
        </div>
        ${badgesHtml}
        ${progressBarHtml}
        <div class="campaign-meta">
          <span class="campaign-account" title="Sending account">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            ${escapeHtml(accountLabel)}
          </span>
          <span class="campaign-time">${escapeHtml(timeLabel)}</span>
        </div>
        ${errorHtml}
        <div class="campaign-actions">
          <div class="actions-left">${detailsToggleHtml}</div>
          <div class="actions-right">${actionsHtml}</div>
        </div>
        ${drawerHtml}
      `;

      // Attach button event listeners
      const btnRun = card.querySelector('[data-action="run"]');
      const btnCancel = card.querySelector('[data-action="cancel"]');
      const btnDelete = card.querySelector('[data-action="delete"]');
      const btnDrawer = card.querySelector('[data-toggle]');

      if (btnDrawer) {
        btnDrawer.addEventListener('click', (e) => {
          e.stopPropagation();
          const drawer = card.querySelector(`#drawer-${camp.id}`);
          if (drawer) {
            const isHidden = drawer.style.display === 'none';
            drawer.style.display = isHidden ? 'block' : 'none';
            btnDrawer.textContent = isHidden ? '▾ Hide' : '▸ Details';
          }
        });
      }

      if (btnRun) {
        btnRun.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerRunNow(camp.id);
        });
      }
      if (btnCancel) {
        btnCancel.addEventListener('click', (e) => {
          e.stopPropagation();
          cancelCampaign(camp.id);
        });
      }
      if (btnDelete) {
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteCampaign(camp.id);
        });
      }

      campaignsList.appendChild(card);
    });
  }

  /**
   * Triggers a campaign immediately
   */
  async function triggerRunNow(campaignId) {
    try {
      showToast('Executing campaign...');
      const response = await chrome.runtime.sendMessage({
        action: 'TRIGGER_CAMPAIGN_NOW',
        campaignId
      });

      if (response && response.success) {
        showToast('Campaign execution started');
      } else {
        showToast(response?.error || 'Trigger dispatched');
      }

      // Reload state after slight delay
      setTimeout(loadCampaigns, 1500);
    } catch (err) {
      console.error('[Popup] Run Now error:', err);
      showToast('Error: ' + err.message);
    }
  }

  /**
   * Cancels a queued campaign
   */
  async function cancelCampaign(campaignId) {
    try {
      if (window.IDBStore) {
        await window.IDBStore.updateCampaign(campaignId, {
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString()
        });
        await window.IDBStore.addLog(campaignId, 'WARN', 'Campaign cancelled by user in popup.');
      }
      try {
        await chrome.runtime.sendMessage({ action: 'REFRESH_BADGE' });
      } catch (_) {}

      showToast('Campaign cancelled');
      await loadCampaigns();
    } catch (err) {
      console.error('[Popup] Cancel error:', err);
      showToast('Failed to cancel');
    }
  }

  /**
   * Deletes a campaign from IndexedDB
   */
  async function deleteCampaign(campaignId) {
    try {
      if (window.IDBStore) {
        await window.IDBStore.deleteCampaign(campaignId);
      }
      try {
        await chrome.runtime.sendMessage({ action: 'REFRESH_BADGE' });
      } catch (_) {}

      showToast('Campaign deleted');
      await loadCampaigns();
    } catch (err) {
      console.error('[Popup] Delete error:', err);
      showToast('Failed to delete');
    }
  }

  /**
   * Manual refresh with rotation animation
   */
  async function handleManualRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    btnRefresh.classList.add('spinning');
    try {
      await syncFromGmailTabs();
      await loadCampaigns();
      await updateSchedulerStatus();
      showToast('Campaigns synchronized');
    } catch (err) {
      showToast('Refresh error');
    } finally {
      setTimeout(() => {
        btnRefresh.classList.remove('spinning');
        isRefreshing = false;
      }, 500);
    }
  }

  /**
   * Toggles background scheduler
   */
  async function handleSchedulerToggle() {
    const active = schedulerToggle.checked;
    try {
      await chrome.runtime.sendMessage({
        action: 'TOGGLE_SCHEDULER',
        active
      });
      applySchedulerUI(active);
      showToast(active ? 'Scheduler activated' : 'Scheduler paused');
    } catch (err) {
      console.error('[Popup] Toggle scheduler error:', err);
      schedulerToggle.checked = !active;
      showToast('Failed to toggle scheduler');
    }
  }

  /**
   * Opens the diagnostics dashboard in a new tab
   */
  async function openFullDashboard() {
    try {
      await chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      window.close();
    } catch (_) {
      const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
      chrome.tabs.create({ url });
      window.close();
    }
  }

  /**
   * Formats timestamp into clean human string
   */
  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) {
        return 'Today at ' + timeStr;
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + timeStr;
    } catch (_) {
      return '';
    }
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  // Live updates from background worker or Gmail automator
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'CAMPAIGN_PROGRESS' || msg.action === 'CAMPAIGN_STATUS_UPDATE') {
        loadCampaigns().catch(() => {});
      }
    });
  }
});
