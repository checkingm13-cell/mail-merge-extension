/**
 * Gmail Native Mail Merge & Scheduler - Dashboard Logic
 * Full management dashboard connecting with IDBStore and background service worker
 */

document.addEventListener('DOMContentLoaded', async () => {
  // State
  let allCampaigns = [];
  let allTemplates = [];
  let allLogs = [];
  let currentCampaignFilter = 'ALL';
  let currentLogFilter = 'ALL';
  let schedulerIntervalTimer = null;

  // DOM Elements - Navigation & Header
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const headerStatusDot = document.getElementById('headerStatusDot');
  const headerStatusText = document.getElementById('headerStatusText');
  const btnTopToggleScheduler = document.getElementById('btnTopToggleScheduler');
  const btnHeaderOpenGmail = document.getElementById('btnHeaderOpenGmail');
  const tabBadgeCampaigns = document.getElementById('tabBadgeCampaigns');
  const tabBadgeTemplates = document.getElementById('tabBadgeTemplates');
  const tabBadgeLogs = document.getElementById('tabBadgeLogs');

  // Diagnostics elements
  const diagDbStatus = document.getElementById('diagDbStatus');
  const diagGmailStatus = document.getElementById('diagGmailStatus');
  const diagSchedulerStatus = document.getElementById('diagSchedulerStatus');
  const diagCardGmailDot = document.getElementById('diagCardGmailDot');
  const diagCardSchedulerDot = document.getElementById('diagCardSchedulerDot');
  const diagOpenTabsCount = document.getElementById('diagOpenTabsCount');
  const diagContentScriptState = document.getElementById('diagContentScriptState');
  const diagNextPollCountdown = document.getElementById('diagNextPollCountdown');
  const diagStatCampaigns = document.getElementById('diagStatCampaigns');
  const diagStatTemplates = document.getElementById('diagStatTemplates');
  const diagStatLogs = document.getElementById('diagStatLogs');
  const btnLaunchGmailTab = document.getElementById('btnLaunchGmailTab');

  // Campaigns Tab elements
  const campaignsTableBody = document.getElementById('campaignsTableBody');
  const campaignFilterPills = document.querySelectorAll('[data-status]');
  const btnRefreshCampaigns = document.getElementById('btnRefreshCampaigns');
  const btnJumpToQueue = document.getElementById('btnJumpToQueue');
  const countAll = document.getElementById('countAll');
  const countFilterQueued = document.getElementById('countFilterQueued');
  const countFilterProcessing = document.getElementById('countFilterProcessing');
  const countFilterCompleted = document.getElementById('countFilterCompleted');
  const countFilterFailed = document.getElementById('countFilterFailed');
  const countFilterCancelled = document.getElementById('countFilterCancelled');

  // Queue Tab elements
  const newCampaignForm = document.getElementById('newCampaignForm');
  const formSenderEmail = document.getElementById('formSenderEmail');
  const formRecipientCol = document.getElementById('formRecipientCol');
  const formSheetUrl = document.getElementById('formSheetUrl');
  const extractedSheetIdBadge = document.getElementById('extractedSheetIdBadge');
  const formSheetTitle = document.getElementById('formSheetTitle');
  const formSubject = document.getElementById('formSubject');
  const formBodyTemplate = document.getElementById('formBodyTemplate');
  const modeImmediate = document.getElementById('modeImmediate');
  const modeScheduled = document.getElementById('modeScheduled');
  const formScheduledTime = document.getElementById('formScheduledTime');
  const formIncludeUnsub = document.getElementById('formIncludeUnsub');
  const formDryRun = document.getElementById('formDryRun');
  const btnResetForm = document.getElementById('btnResetForm');
  const btnPresetCfp = document.getElementById('btnPresetCfp');
  const btnPresetResearch = document.getElementById('btnPresetResearch');
  const btnPresetReminder = document.getElementById('btnPresetReminder');

  // Templates Tab elements
  const templatesGrid = document.getElementById('templatesGrid');
  const btnOpenCreateTemplate = document.getElementById('btnOpenCreateTemplate');
  const modalTemplate = document.getElementById('modalTemplate');
  const modalTemplateTitle = document.getElementById('modalTemplateTitle');
  const editTemplateId = document.getElementById('editTemplateId');
  const editTemplateName = document.getElementById('editTemplateName');
  const editTemplateSubject = document.getElementById('editTemplateSubject');
  const editTemplateBody = document.getElementById('editTemplateBody');
  const btnSaveTemplate = document.getElementById('btnSaveTemplate');

  // Logs Tab elements
  const logConsole = document.getElementById('logConsole');
  const logFilterPills = document.querySelectorAll('[data-logfilter]');
  const btnRefreshLogs = document.getElementById('btnRefreshLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');

  // Reschedule & Details Modals
  const modalReschedule = document.getElementById('modalReschedule');
  const rescheduleCampaignId = document.getElementById('rescheduleCampaignId');
  const inputRescheduleTime = document.getElementById('inputRescheduleTime');
  const btnConfirmReschedule = document.getElementById('btnConfirmReschedule');
  const modalCampaignDetails = document.getElementById('modalCampaignDetails');
  const modalDetailsTitle = document.getElementById('modalDetailsTitle');
  const modalDetailsContent = document.getElementById('modalDetailsContent');

  const toast = document.getElementById('dashboardToast');

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  await initDB();
  setupEventListeners();
  await refreshAll();

  // Periodic status poll every 10 seconds
  schedulerIntervalTimer = setInterval(async () => {
    await checkSystemDiagnostics();
  }, 10000);

  async function initDB() {
    try {
      if (window.IDBStore) {
        await window.IDBStore.init();
        diagDbStatus.textContent = 'CONNECTED';
        diagDbStatus.style.color = 'var(--emerald)';
      } else {
        diagDbStatus.textContent = 'UNAVAILABLE';
        diagDbStatus.style.color = 'var(--rose)';
      }
    } catch (err) {
      console.error('[Dashboard] IDBStore init error:', err);
      diagDbStatus.textContent = 'ERROR';
      diagDbStatus.style.color = 'var(--rose)';
    }
  }

  async function refreshAll() {
    await Promise.all([
      loadCampaigns(),
      loadTemplates(),
      loadLogs(),
      checkSystemDiagnostics()
    ]);
  }

  // =========================================================================
  // EVENT LISTENERS SETUP
  // =========================================================================

  function setupEventListeners() {
    // Tab Switching
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-tab');
        switchTab(targetId);
      });
    });

    btnJumpToQueue.addEventListener('click', () => switchTab('tab-queue'));

    // Header Actions
    btnTopToggleScheduler.addEventListener('click', toggleScheduler);
    btnHeaderOpenGmail.addEventListener('click', openGmailTab);
    btnLaunchGmailTab.addEventListener('click', openGmailTab);

    // Campaigns Actions & Filter
    btnRefreshCampaigns.addEventListener('click', async () => {
      await loadCampaigns();
      showToast('Campaigns list refreshed');
    });

    campaignFilterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        campaignFilterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentCampaignFilter = pill.getAttribute('data-status');
        renderCampaignsTable();
      });
    });

    // Queue Form Interactions
    formSheetUrl.addEventListener('input', () => {
      const url = formSheetUrl.value.trim();
      const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        extractedSheetIdBadge.textContent = `ID: ${match[1].substring(0, 12)}...`;
        extractedSheetIdBadge.style.display = 'inline-flex';
      } else {
        extractedSheetIdBadge.style.display = 'none';
      }
    });

    modeImmediate.addEventListener('change', () => {
      formScheduledTime.style.display = 'none';
      formScheduledTime.removeAttribute('required');
    });

    modeScheduled.addEventListener('change', () => {
      formScheduledTime.style.display = 'block';
      formScheduledTime.setAttribute('required', 'true');
      if (!formScheduledTime.value) {
        // Set default to 15 minutes from now
        const d = new Date(Date.now() + 15 * 60000);
        formScheduledTime.value = formatDateTimeLocal(d);
      }
    });

    // Merge Tag Pills for Form
    document.querySelectorAll('.tag-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const targetId = pill.getAttribute('data-target');
        const tag = pill.getAttribute('data-tag');
        const inputEl = document.getElementById(targetId);
        if (inputEl) {
          insertAtCursor(inputEl, tag);
        }
      });
    });

    // Canned Template Preset Buttons
    btnPresetCfp.addEventListener('click', () => applyTemplatePreset('template-cfp'));
    btnPresetResearch.addEventListener('click', () => applyTemplatePreset('template-research'));
    btnPresetReminder.addEventListener('click', () => applyTemplatePreset('template-deadline'));

    // Reset Form
    btnResetForm.addEventListener('click', () => {
      newCampaignForm.reset();
      extractedSheetIdBadge.style.display = 'none';
      formScheduledTime.style.display = 'none';
      modeImmediate.checked = true;
      showToast('Form reset');
    });

    // Queue Form Submit
    newCampaignForm.addEventListener('submit', handleQueueCampaignSubmit);

    // Templates Tab
    btnOpenCreateTemplate.addEventListener('click', () => {
      editTemplateId.value = '';
      editTemplateName.value = '';
      editTemplateSubject.value = '';
      editTemplateBody.value = '';
      modalTemplateTitle.textContent = 'Create Template';
      openModal('modalTemplate');
    });

    btnSaveTemplate.addEventListener('click', handleSaveTemplateSubmit);

    // Logs Tab Actions & Filters
    btnRefreshLogs.addEventListener('click', async () => {
      await loadLogs();
      showToast('Logs refreshed');
    });

    btnClearLogs.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all execution logs?')) {
        await window.IDBStore.clearLogs();
        await loadLogs();
        showToast('All logs cleared');
      }
    });

    logFilterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        logFilterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentLogFilter = pill.getAttribute('data-logfilter');
        renderLogsConsole();
      });
    });

    // Modal Close buttons
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        closeModal(modalId);
      });
    });

    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // Reschedule Confirmation
    btnConfirmReschedule.addEventListener('click', handleConfirmReschedule);
  }

  // =========================================================================
  // TABS NAVIGATION
  // =========================================================================

  function switchTab(targetTabId) {
    tabButtons.forEach((btn) => {
      if (btn.getAttribute('data-tab') === targetTabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabPanes.forEach((pane) => {
      if (pane.id === targetTabId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });
  }

  // =========================================================================
  // DIAGNOSTICS & SCHEDULER CONTROLS
  // =========================================================================

  async function checkSystemDiagnostics() {
    // 1. Check open Gmail tabs
    try {
      const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
      const count = gmailTabs ? gmailTabs.length : 0;
      diagOpenTabsCount.textContent = String(count);

      if (count > 0) {
        diagGmailStatus.textContent = 'CONNECTED (' + count + ')';
        diagGmailStatus.style.color = 'var(--emerald)';
        diagCardGmailDot.className = 'indicator-dot';
        diagContentScriptState.textContent = 'Ready & Mounted';
        diagContentScriptState.style.color = 'var(--emerald)';
      } else {
        diagGmailStatus.textContent = 'NO OPEN TAB';
        diagGmailStatus.style.color = 'var(--amber)';
        diagCardGmailDot.className = 'indicator-dot paused';
        diagContentScriptState.textContent = 'Standby (Tab opens on run)';
        diagContentScriptState.style.color = 'var(--text-muted)';
      }
    } catch (err) {
      console.warn('[Dashboard] Error querying tabs:', err);
    }

    // 2. Check Background Scheduler Status
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SCHEDULER_STATUS' });
      if (response && response.success && response.status) {
        const { alarmActive, nextScheduledPoll } = response.status;
        applySchedulerStatusUI(alarmActive, nextScheduledPoll);
      } else {
        // Fallback to chrome.alarms
        const alarm = await chrome.alarms.get('POLL_CAMPAIGNS_ALARM');
        applySchedulerStatusUI(!!alarm, alarm ? new Date(alarm.scheduledTime).toISOString() : null);
      }
    } catch (err) {
      // Fallback
      try {
        const alarm = await chrome.alarms.get('POLL_CAMPAIGNS_ALARM');
        applySchedulerStatusUI(!!alarm, alarm ? new Date(alarm.scheduledTime).toISOString() : null);
      } catch (alarmErr) {
        applySchedulerStatusUI(false, null);
      }
    }

    // 3. Update DB Counts
    if (window.IDBStore) {
      diagStatCampaigns.textContent = String(allCampaigns.length);
      diagStatTemplates.textContent = String(allTemplates.length);
      diagStatLogs.textContent = String(allLogs.length);
    }
  }

  function applySchedulerStatusUI(isActive, nextPoll) {
    if (isActive) {
      headerStatusDot.className = 'indicator-dot';
      headerStatusText.textContent = 'Scheduler Active';
      diagSchedulerStatus.textContent = 'ACTIVE (1m)';
      diagSchedulerStatus.style.color = 'var(--emerald)';
      diagCardSchedulerDot.className = 'indicator-dot';

      if (nextPoll) {
        const diffMs = new Date(nextPoll).getTime() - Date.now();
        const diffSec = Math.max(0, Math.round(diffMs / 1000));
        diagNextPollCountdown.textContent = diffSec > 0 ? `In ~${diffSec}s` : 'Polling now';
      } else {
        diagNextPollCountdown.textContent = 'Within 60s';
      }
    } else {
      headerStatusDot.className = 'indicator-dot paused';
      headerStatusText.textContent = 'Scheduler Paused';
      diagSchedulerStatus.textContent = 'PAUSED';
      diagSchedulerStatus.style.color = 'var(--amber)';
      diagCardSchedulerDot.className = 'indicator-dot paused';
      diagNextPollCountdown.textContent = 'Paused';
    }
  }

  async function toggleScheduler() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'TOGGLE_SCHEDULER' });
      if (response && response.success) {
        applySchedulerStatusUI(response.active, null);
        showToast(response.active ? 'Scheduler activated' : 'Scheduler paused');
      } else {
        // Fallback local toggle
        const alarm = await chrome.alarms.get('POLL_CAMPAIGNS_ALARM');
        if (alarm) {
          await chrome.alarms.clear('POLL_CAMPAIGNS_ALARM');
          applySchedulerStatusUI(false, null);
          showToast('Scheduler paused');
        } else {
          await chrome.alarms.create('POLL_CAMPAIGNS_ALARM', { periodInMinutes: 1 });
          applySchedulerStatusUI(true, null);
          showToast('Scheduler activated');
        }
      }
      await checkSystemDiagnostics();
    } catch (err) {
      console.error('[Dashboard] Error toggling scheduler:', err);
      showToast('Error toggling scheduler');
    }
  }

  async function openGmailTab() {
    try {
      const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
      if (gmailTabs && gmailTabs.length > 0) {
        await chrome.tabs.update(gmailTabs[0].id, { active: true });
        if (gmailTabs[0].windowId) {
          await chrome.windows.update(gmailTabs[0].windowId, { focused: true });
        }
      } else {
        await chrome.tabs.create({ url: 'https://mail.google.com/' });
      }
      setTimeout(checkSystemDiagnostics, 1500);
    } catch (err) {
      window.open('https://mail.google.com/', '_blank');
    }
  }

  // =========================================================================
  // TAB 1: CAMPAIGNS
  // =========================================================================

  async function loadCampaigns() {
    try {
      // Request any open Gmail tabs to sync their local campaigns to background store
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
          for (const t of gmailTabs) {
            chrome.tabs.sendMessage(t.id, { action: 'REQUEST_CAMPAIGN_SYNC' }).catch(() => {});
          }
        }
      } catch (_) {}

      if (window.IDBStore) {
        allCampaigns = await window.IDBStore.getCampaigns();
      } else {
        allCampaigns = [];
      }

      tabBadgeCampaigns.textContent = String(allCampaigns.length);

      // Update counts
      const counts = {
        ALL: allCampaigns.length,
        QUEUED: 0,
        PROCESSING: 0,
        COMPLETED: 0,
        FAILED: 0,
        CANCELLED: 0
      };

      allCampaigns.forEach((c) => {
        if (counts[c.status] !== undefined) {
          counts[c.status]++;
        }
      });

      countAll.textContent = String(counts.ALL);
      countFilterQueued.textContent = String(counts.QUEUED);
      countFilterProcessing.textContent = String(counts.PROCESSING);
      countFilterCompleted.textContent = String(counts.COMPLETED);
      countFilterFailed.textContent = String(counts.FAILED);
      countFilterCancelled.textContent = String(counts.CANCELLED);

      renderCampaignsTable();
    } catch (err) {
      console.error('[Dashboard] Error loading campaigns:', err);
      campaignsTableBody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: var(--rose);">Error loading campaigns: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderCampaignsTable() {
    let filtered = allCampaigns;
    if (currentCampaignFilter !== 'ALL') {
      filtered = allCampaigns.filter((c) => c.status === currentCampaignFilter);
    }

    if (filtered.length === 0) {
      campaignsTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="table-empty">
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">No campaigns found</div>
            <div style="font-size: 12px; color: var(--text-muted);">
              ${currentCampaignFilter === 'ALL' ? 'Queue your first mail merge campaign using the "+ Queue New Campaign" tab.' : `No campaigns with status "${currentCampaignFilter}".`}
            </div>
          </td>
        </tr>
      `;
      return;
    }

    campaignsTableBody.innerHTML = '';

    filtered.forEach((camp) => {
      const tr = document.createElement('tr');

      // Status Badge Style
      let badgeClass = 'badge-queued';
      if (camp.status === 'PROCESSING') badgeClass = 'badge-processing';
      else if (camp.status === 'COMPLETED') badgeClass = 'badge-completed';
      else if (camp.status === 'FAILED') badgeClass = 'badge-failed';
      else if (camp.status === 'CANCELLED') badgeClass = 'badge-cancelled';

      // Sheet Link & Title
      const sheetTitle = camp.spreadsheetTitle || extractSheetName(camp.spreadsheetUrl) || 'Google Sheet';
      const sheetLinkHtml = camp.spreadsheetUrl
        ? `<a href="${escapeHtml(camp.spreadsheetUrl)}" target="_blank" style="color: var(--sky); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
            <span>${escapeHtml(sheetTitle)}</span>
            <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
           </a>`
        : `<span style="color: var(--text-muted);">None</span>`;

      // Scheduled Time formatting
      const scheduleDisplay = formatFullScheduledTime(camp.scheduledAt);

      // Short ID
      const shortId = camp.id ? camp.id.substring(0, 10) : 'camp';

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); color: var(--text-muted); font-size: 11px;" title="${escapeHtml(camp.id)}">
          ${escapeHtml(shortId)}
        </td>
        <td style="font-weight: 600; color: var(--text-white); max-width: 260px;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(camp.subject || '')}">
            ${escapeHtml(camp.subject || 'Untitled Subject')}
          </div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
            Sender: ${escapeHtml(camp.senderEmail || 'Default Profile')}
          </div>
        </td>
        <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${sheetLinkHtml}
        </td>
        <td>
          <span style="background: var(--bg-input); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 11px;">
            ${escapeHtml(camp.recipientColumn || 'Email')}
          </span>
        </td>
        <td style="font-size: 11px; white-space: nowrap;">
          ${scheduleDisplay}
        </td>
        <td>
          <span class="badge ${badgeClass}">
            ${camp.status === 'PROCESSING' ? '● ' : ''}${escapeHtml(camp.status)}
          </span>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
            <button class="btn btn-secondary btn-sm btn-table-run" data-id="${camp.id}" title="Run immediately">
              ▶ Run Now
            </button>
            <button class="btn btn-secondary btn-sm btn-table-reschedule" data-id="${camp.id}" title="Reschedule">
              ⏰ Reschedule
            </button>
            <button class="btn btn-secondary btn-sm btn-table-details" data-id="${camp.id}" title="View Details & Logs">
              📋 Details
            </button>
            <button class="btn btn-danger btn-sm btn-table-cancel" data-id="${camp.id}" title="Cancel or Delete">
              ✕
            </button>
          </div>
        </td>
      `;

      // Actions
      tr.querySelector('.btn-table-run').addEventListener('click', () => triggerCampaign(camp.id));
      tr.querySelector('.btn-table-reschedule').addEventListener('click', () => openRescheduleModal(camp));
      tr.querySelector('.btn-table-details').addEventListener('click', () => openDetailsModal(camp));
      tr.querySelector('.btn-table-cancel').addEventListener('click', () => deleteOrCancelCampaign(camp.id));

      campaignsTableBody.appendChild(tr);
    });
  }

  async function triggerCampaign(campaignId) {
    try {
      showToast('Triggering campaign execution...');
      const response = await chrome.runtime.sendMessage({
        action: 'TRIGGER_CAMPAIGN_NOW',
        campaignId
      });

      if (response && response.success) {
        showToast('Campaign successfully dispatched to background engine');
      } else {
        showToast(response?.error || 'Trigger command dispatched');
      }

      await loadCampaigns();
      await loadLogs();
    } catch (err) {
      console.error('[Dashboard] Trigger campaign error:', err);
      showToast('Trigger failed: ' + err.message);
    }
  }

  function openRescheduleModal(camp) {
    rescheduleCampaignId.value = camp.id;
    if (camp.scheduledAt) {
      inputRescheduleTime.value = formatDateTimeLocal(new Date(camp.scheduledAt));
    } else {
      inputRescheduleTime.value = formatDateTimeLocal(new Date(Date.now() + 15 * 60000));
    }
    openModal('modalReschedule');
  }

  async function handleConfirmReschedule() {
    const id = rescheduleCampaignId.value;
    const newTime = inputRescheduleTime.value;

    if (!newTime) {
      alert('Please choose a valid date and time.');
      return;
    }

    const isoDate = new Date(newTime).toISOString();

    try {
      await window.IDBStore.updateCampaign(id, {
        scheduledAt: isoDate,
        status: 'QUEUED'
      });
      await window.IDBStore.addLog(id, 'INFO', `Rescheduled to ${isoDate}`);

      try {
        await chrome.runtime.sendMessage({
          action: 'REGISTER_SCHEDULED_ALARM',
          campaignId: id,
          scheduledTime: new Date(isoDate).getTime()
        });
      } catch (alarmErr) {}

      closeModal('modalReschedule');
      showToast('Campaign rescheduled successfully');
      await loadCampaigns();
    } catch (err) {
      console.error('[Dashboard] Reschedule error:', err);
      alert('Failed to reschedule: ' + err.message);
    }
  }

  async function deleteOrCancelCampaign(campaignId) {
    if (!confirm('Are you sure you want to cancel and remove this campaign?')) {
      return;
    }

    try {
      await window.IDBStore.deleteCampaign(campaignId);
      await window.IDBStore.addLog(campaignId, 'WARN', 'Campaign deleted from dashboard.');

      try {
        await chrome.runtime.sendMessage({ action: 'REFRESH_BADGE' });
      } catch (e) {}

      showToast('Campaign removed');
      await loadCampaigns();
    } catch (err) {
      console.error('[Dashboard] Delete campaign error:', err);
      showToast('Failed to delete campaign');
    }
  }

  async function openDetailsModal(camp) {
    modalDetailsTitle.textContent = `Campaign Details - ${camp.id}`;

    // Get logs for this campaign
    let relatedLogs = [];
    if (window.IDBStore) {
      const logs = await window.IDBStore.getLogs(300);
      relatedLogs = logs.filter((l) => l.campaignId === camp.id);
    }

    const logsHtml = relatedLogs.length > 0
      ? relatedLogs.map((l) => `
          <div style="padding: 4px 0; border-bottom: 1px solid rgba(51, 65, 85, 0.3); font-size: 11px; font-family: var(--font-mono);">
            <span style="color: var(--text-muted);">${formatTimeShort(l.timestamp)}</span>
            <span class="log-level ${l.level}">${l.level}</span>
            <span style="color: var(--text-primary);">${escapeHtml(l.message)}</span>
          </div>
        `).join('')
      : `<div style="color: var(--text-muted); font-size: 11px;">No specific execution logs recorded for this campaign.</div>`;

    modalDetailsContent.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
          <div>
            <span style="color: var(--text-muted);">Status:</span>
            <span class="badge ${camp.status === 'COMPLETED' ? 'badge-completed' : (camp.status === 'FAILED' ? 'badge-failed' : 'badge-queued')}" style="margin-left: 6px;">
              ${escapeHtml(camp.status)}
            </span>
          </div>
          <div>
            <span style="color: var(--text-muted);">Recipient Column:</span>
            <strong style="margin-left: 6px;">${escapeHtml(camp.recipientColumn || 'Email')}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Scheduled:</span>
            <span style="margin-left: 6px;">${escapeHtml(camp.scheduledAt || 'Immediate')}</span>
          </div>
          <div>
            <span style="color: var(--text-muted);">Created:</span>
            <span style="margin-left: 6px;">${escapeHtml(camp.createdAt ? new Date(camp.createdAt).toLocaleString() : '--')}</span>
          </div>
        </div>

        <div>
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Google Sheet</label>
          <div style="background: var(--bg-input); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 12px; margin-top: 4px; word-break: break-all;">
            <a href="${escapeHtml(camp.spreadsheetUrl || '')}" target="_blank" style="color: var(--sky);">
              ${escapeHtml(camp.spreadsheetUrl || 'No URL specified')}
            </a>
          </div>
        </div>

        <div>
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Subject</label>
          <div style="background: var(--bg-input); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); font-weight: 600; color: var(--text-white); font-size: 12px; margin-top: 4px;">
            ${escapeHtml(camp.subject || '')}
          </div>
        </div>

        ${camp.errorMessage ? `
          <div>
            <label style="font-size: 11px; font-weight: 600; color: var(--rose); text-transform: uppercase;">Execution Error Details</label>
            <div style="background: rgba(244, 63, 94, 0.1); border: 1px solid var(--rose-border); padding: 10px; border-radius: 6px; color: #fca5a5; font-size: 12px; margin-top: 4px; font-family: var(--font-mono);">
              ${escapeHtml(camp.errorMessage)}
            </div>
          </div>
        ` : ''}

        <div>
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Body Template Preview</label>
          <div style="background: var(--bg-input); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 11px; max-height: 140px; overflow-y: auto; white-space: pre-wrap; margin-top: 4px;">
            ${escapeHtml(camp.bodyTemplate || '')}
          </div>
        </div>

        <div>
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Activity & Execution Logs</label>
          <div style="background: #050811; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; max-height: 160px; overflow-y: auto; margin-top: 4px;">
            ${logsHtml}
          </div>
        </div>
      </div>
    `;

    openModal('modalCampaignDetails');
  }

  // =========================================================================
  // TAB 2: QUEUE NEW CAMPAIGN
  // =========================================================================

  async function handleQueueCampaignSubmit(e) {
    e.preventDefault();

    const senderEmail = formSenderEmail.value;
    const recipientColumn = formRecipientCol.value.trim() || 'Email';
    const spreadsheetUrl = formSheetUrl.value.trim();
    const spreadsheetTitle = formSheetTitle.value.trim();
    const subject = formSubject.value.trim();
    const bodyTemplate = formBodyTemplate.value.trim();
    const includeUnsub = formIncludeUnsub.checked;
    const dryRun = formDryRun ? formDryRun.checked : true;

    if (!spreadsheetUrl || !subject || !bodyTemplate) {
      alert('Please provide a Google Sheet URL, Subject, and Email Body.');
      return;
    }

    // Determine scheduled date
    let scheduledAt = null;
    if (modeScheduled.checked && formScheduledTime.value) {
      scheduledAt = new Date(formScheduledTime.value).toISOString();
    }

    const campaign = {
      id: 'camp_' + Date.now(),
      senderEmail,
      recipientColumn,
      spreadsheetUrl,
      spreadsheetTitle: spreadsheetTitle || extractSheetName(spreadsheetUrl) || 'Google Sheet',
      subject,
      bodyTemplate,
      includeUnsub,
      dryRun,
      scheduledAt,
      status: 'QUEUED',
      createdAt: new Date().toISOString()
    };

    try {
      await window.IDBStore.saveCampaign(campaign);
      await window.IDBStore.addLog(
        campaign.id,
        'INFO',
        `Campaign "${campaign.subject}" queued directly from Dashboard.`
      );

      // Notify background to update badge
      try {
        await chrome.runtime.sendMessage({ action: 'REFRESH_BADGE' });
      } catch (err) {}

      // If immediate, trigger scheduler check, else register exact alarm
      if (!scheduledAt) {
        try {
          await chrome.runtime.sendMessage({
            action: 'TRIGGER_CAMPAIGN_NOW',
            campaignId: campaign.id
          });
        } catch (runErr) {
          console.warn('[Dashboard] Immediate trigger error (will be picked up by alarm):', runErr);
        }
      } else {
        try {
          await chrome.runtime.sendMessage({
            action: 'REGISTER_SCHEDULED_ALARM',
            campaignId: campaign.id,
            scheduledTime: new Date(scheduledAt).getTime()
          });
        } catch (alarmErr) {
          console.warn('[Dashboard] Failed to register alarm:', alarmErr);
        }
      }

      showToast(scheduledAt ? 'Campaign scheduled successfully!' : 'Campaign queued & dispatched!');

      // Reset form and switch to Campaigns tab
      newCampaignForm.reset();
      extractedSheetIdBadge.style.display = 'none';
      formScheduledTime.style.display = 'none';
      modeImmediate.checked = true;

      await loadCampaigns();
      switchTab('tab-campaigns');
    } catch (err) {
      console.error('[Dashboard] Error saving campaign:', err);
      alert('Failed to save campaign: ' + err.message);
    }
  }

  async function applyTemplatePreset(templateId) {
    try {
      let tpl = allTemplates.find((t) => t.id === templateId);
      if (!tpl && window.IDBStore) {
        const templates = await window.IDBStore.getTemplates();
        tpl = templates.find((t) => t.id === templateId);
      }

      if (tpl) {
        formSubject.value = tpl.subject || '';
        formBodyTemplate.value = tpl.body || '';
        showToast(`Applied preset: ${tpl.name}`);
      } else {
        showToast('Preset template not found');
      }
    } catch (err) {
      console.error('[Dashboard] Preset load error:', err);
    }
  }

  // =========================================================================
  // TAB 3: TEMPLATES MANAGER
  // =========================================================================

  async function loadTemplates() {
    try {
      if (window.IDBStore) {
        allTemplates = await window.IDBStore.getTemplates();
      } else {
        allTemplates = [];
      }

      tabBadgeTemplates.textContent = String(allTemplates.length);
      renderTemplatesGrid();
    } catch (err) {
      console.error('[Dashboard] Error loading templates:', err);
      templatesGrid.innerHTML = `<div class="table-empty" style="color: var(--rose); grid-column: 1 / -1;">Error loading templates: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderTemplatesGrid() {
    if (allTemplates.length === 0) {
      templatesGrid.innerHTML = `
        <div class="table-empty" style="grid-column: 1 / -1;">
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">No templates saved</div>
          <div style="font-size: 12px; color: var(--text-muted);">Click "+ Create Template" above to add your first reusable message template.</div>
        </div>
      `;
      return;
    }

    templatesGrid.innerHTML = '';

    allTemplates.forEach((tpl) => {
      const card = document.createElement('div');
      card.className = 'template-card';

      card.innerHTML = `
        <div>
          <h3 class="template-card-title">${escapeHtml(tpl.name || 'Untitled Template')}</h3>
          <div class="template-card-subject" title="${escapeHtml(tpl.subject || '')}">
            Subject: ${escapeHtml(tpl.subject || 'No Subject')}
          </div>
          <div class="template-card-preview">${escapeHtml(tpl.body || '')}</div>
        </div>
        <div class="template-card-actions">
          <button class="btn btn-primary btn-sm btn-use-template">
            <span>🚀 Use in Campaign</span>
          </button>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm btn-edit-template" title="Edit template">
              ✏️ Edit
            </button>
            <button class="btn btn-danger btn-sm btn-del-template" title="Delete template">
              🗑️
            </button>
          </div>
        </div>
      `;

      card.querySelector('.btn-use-template').addEventListener('click', () => {
        formSubject.value = tpl.subject || '';
        formBodyTemplate.value = tpl.body || '';
        showToast(`Template "${tpl.name}" loaded into Queue form`);
        switchTab('tab-queue');
      });

      card.querySelector('.btn-edit-template').addEventListener('click', () => {
        editTemplateId.value = tpl.id;
        editTemplateName.value = tpl.name || '';
        editTemplateSubject.value = tpl.subject || '';
        editTemplateBody.value = tpl.body || '';
        modalTemplateTitle.textContent = 'Edit Template';
        openModal('modalTemplate');
      });

      card.querySelector('.btn-del-template').addEventListener('click', async () => {
        if (confirm(`Delete template "${tpl.name}"?`)) {
          await window.IDBStore.deleteTemplate(tpl.id);
          showToast('Template deleted');
          await loadTemplates();
        }
      });

      templatesGrid.appendChild(card);
    });
  }

  async function handleSaveTemplateSubmit(e) {
    e.preventDefault();

    const id = editTemplateId.value;
    const name = editTemplateName.value.trim();
    const subject = editTemplateSubject.value.trim();
    const body = editTemplateBody.value.trim();

    if (!name || !subject || !body) {
      alert('Please fill out Name, Subject, and Email Body.');
      return;
    }

    try {
      const template = {
        id: id || undefined,
        name,
        subject,
        body
      };

      await window.IDBStore.saveTemplate(template);
      closeModal('modalTemplate');
      showToast('Template saved successfully');
      await loadTemplates();
    } catch (err) {
      console.error('[Dashboard] Error saving template:', err);
      alert('Failed to save template: ' + err.message);
    }
  }

  // =========================================================================
  // TAB 4: EXECUTION LOGS & DIAGNOSTICS
  // =========================================================================

  async function loadLogs() {
    try {
      if (window.IDBStore) {
        allLogs = await window.IDBStore.getLogs(300);
      } else {
        allLogs = [];
      }

      tabBadgeLogs.textContent = String(allLogs.length);
      renderLogsConsole();
    } catch (err) {
      console.error('[Dashboard] Error loading logs:', err);
      logConsole.innerHTML = `<div style="color: var(--rose); padding: 12px;">Error loading logs: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderLogsConsole() {
    let filtered = allLogs;
    if (currentLogFilter !== 'ALL') {
      filtered = allLogs.filter((l) => l.level === currentLogFilter);
    }

    if (filtered.length === 0) {
      logConsole.innerHTML = `<div style="color: var(--text-muted); padding: 16px; text-align: center;">No logs matching filter "${currentLogFilter}".</div>`;
      return;
    }

    logConsole.innerHTML = '';

    filtered.forEach((log) => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';

      const timeStr = formatTimeFull(log.timestamp);
      const campIdStr = log.campaignId ? `[${log.campaignId.substring(0, 10)}]` : '[SYS]';

      entry.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="log-level ${log.level}">${log.level}</span>
        <span class="log-campaign">${escapeHtml(campIdStr)}</span>
        <span class="log-msg">${escapeHtml(log.message || '')}</span>
      `;

      logConsole.appendChild(entry);
    });
  }

  // =========================================================================
  // MODAL & UTILITY HELPERS
  // =========================================================================

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  function insertAtCursor(input, textToInsert) {
    const startPos = input.selectionStart || input.value.length;
    const endPos = input.selectionEnd || input.value.length;
    input.value = input.value.substring(0, startPos) + textToInsert + input.value.substring(endPos);
    input.focus();
    input.selectionStart = input.selectionEnd = startPos + textToInsert.length;
  }

  function formatDateTimeLocal(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  function formatFullScheduledTime(dateStr) {
    if (!dateStr) return '<span style="color: var(--amber); font-weight: 600;">⚡ Immediate</span>';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '<span style="color: var(--amber);">⚡ Immediate</span>';

    const now = Date.now();
    const isPast = d.getTime() <= now;
    const dateFormatted = d.toLocaleString('en', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (isPast) {
      return `<span style="color: var(--emerald); font-weight: 600;" title="${d.toISOString()}">⏱ Due (${dateFormatted})</span>`;
    }
    return `<span style="color: var(--sky);" title="${d.toISOString()}">📅 ${dateFormatted}</span>`;
  }

  function formatTimeShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatTimeFull(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const date = `${d.getMonth() + 1}/${d.getDate()}`;
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${date} ${time}`;
  }

  function extractSheetName(url) {
    if (!url) return '';
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      return 'Sheet ' + match[1].substring(0, 10) + '...';
    }
    return '';
  }

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
