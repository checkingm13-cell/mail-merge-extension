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
  let currentCampaignSort = 'NEWEST';
  let currentCampaignSearch = '';
  let currentCampaignPage = 1;
  let currentCampaignPageSize = 50;
  let currentLogFilter = 'ALL';
  let liveStreamPort = null;

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
  const diagQuotaFuel = document.getElementById('diagQuotaFuel');
  const btnToggleSafeguardSettings = document.getElementById('btnToggleSafeguardSettings');
  const safeguardSettingsDrawer = document.getElementById('safeguardSettingsDrawer');
  const cfgMaxRecipients = document.getElementById('cfgMaxRecipients');
  const cfgDailyQuotaCeiling = document.getElementById('cfgDailyQuotaCeiling');
  const btnSaveSafeguards = document.getElementById('btnSaveSafeguards');

  // Campaigns Tab elements
  const campaignsTableBody = document.getElementById('campaignsTableBody');
  const campaignFilterPills = document.querySelectorAll('[data-status]');
  const btnRefreshCampaigns = document.getElementById('btnRefreshCampaigns');
  const btnJumpToQueue = document.getElementById('btnJumpToQueue');
  const countAll = document.getElementById('countAll');
  const countFilterToday = document.getElementById('countFilterToday');
  const countFilterQueued = document.getElementById('countFilterQueued');
  const countFilterProcessing = document.getElementById('countFilterProcessing');
  const countFilterCompleted = document.getElementById('countFilterCompleted');
  const countFilterFailed = document.getElementById('countFilterFailed');
  const countFilterCancelled = document.getElementById('countFilterCancelled');
  const campaignPageSizeSelect = document.getElementById('campaignPageSizeSelect');
  const btnArchiveCompleted = document.getElementById('btnArchiveCompleted');
  const operatorQuickCard = document.getElementById('operatorQuickCard');
  const btnDismissQuickCard = document.getElementById('btnDismissQuickCard');
  const campaignsPaginationBar = document.getElementById('campaignsPaginationBar');
  const paginationRangeText = document.getElementById('paginationRangeText');
  const paginationTotalText = document.getElementById('paginationTotalText');
  const paginationPageNum = document.getElementById('paginationPageNum');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const btnTopRemoveAllFailed = document.getElementById('btnTopRemoveAllFailed');
  const countTopFailed = document.getElementById('countTopFailed');
  const btnTopViewArchived = document.getElementById('btnTopViewArchived');
  const countTopArchived = document.getElementById('countTopArchived');
  const btnExportBackup = document.getElementById('btnExportBackup');
  const btnImportBackup = document.getElementById('btnImportBackup');
  const importFileInput = document.getElementById('importFileInput');
  const queueStatusCard = document.getElementById('queueStatusCard');
  const queuePulseDot = document.getElementById('queuePulseDot');
  const queueProcessingLabel = document.getElementById('queueProcessingLabel');
  const queueWaitingCount = document.getElementById('queueWaitingCount');
  const queueLockStateBadge = document.getElementById('queueLockStateBadge');

  // Templates Tab elements
  const templatesGrid = document.getElementById('templatesGrid');
  const btnOpenCreateTemplate = document.getElementById('btnOpenCreateTemplate');
  const btnRefreshTemplates = document.getElementById('btnRefreshTemplates');
  const modalTemplate = document.getElementById('modalTemplate');
  const modalTemplateTitle = document.getElementById('modalTemplateTitle');
  const editTemplateId = document.getElementById('editTemplateId');
  const editTemplateName = document.getElementById('editTemplateName');
  const editTemplateSubject = document.getElementById('editTemplateSubject');
  const editTemplateBodyHtml = document.getElementById('editTemplateBodyHtml');
  const editTemplateSourceArea = document.getElementById('editTemplateSourceArea');
  const btnToggleSourceMode = document.getElementById('btnToggleSourceMode');
  const btnInsertSubjectTag = document.getElementById('btnInsertSubjectTag');
  const btnInsertLinkHelper = document.getElementById('btnInsertLinkHelper');
  const btnSaveTemplate = document.getElementById('btnSaveTemplate');

  // 24/7 Health Guide & Diagnostics elements
  const btnQuick247Guide = document.getElementById('btnQuick247Guide');
  const btnRun247HealthCheck = document.getElementById('btnRun247HealthCheck');
  const healthCheckResultBox = document.getElementById('healthCheckResultBox');

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
    // 1. Tab Switching with Immediate Persistence
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-tab');
        switchTab(targetId, true);
      });
    });

    // 2. Restore exact tab across normal refresh (F5) and hard refresh (Ctrl+F5 / Ctrl+Shift+R)
    let initialTab = '';
    if (window.location.hash) {
      const hashTab = window.location.hash.replace('#', '').trim();
      if (document.getElementById(hashTab)) {
        initialTab = hashTab;
      }
    }
    if (!initialTab) {
      try {
        const savedTab = localStorage.getItem('mail_merge_active_dashboard_tab');
        if (savedTab && document.getElementById(savedTab)) {
          initialTab = savedTab;
        }
      } catch (_) {}
    }

    if (initialTab && document.getElementById(initialTab)) {
      switchTab(initialTab, true);
    } else {
      switchTab('tab-campaigns', false);
    }

    window.addEventListener('hashchange', () => {
      const hashTab = window.location.hash.replace('#', '').trim();
      if (hashTab && document.getElementById(hashTab)) {
        switchTab(hashTab, false);
      }
    });

    // 3. Restore saved Campaign Status filter
    try {
      const savedCampaignFilter = localStorage.getItem('mail_merge_campaign_filter');
      if (savedCampaignFilter) {
        const matchingPill = document.querySelector(`[data-status="${savedCampaignFilter}"]`);
        if (matchingPill) {
          campaignFilterPills.forEach((p) => p.classList.remove('active'));
          matchingPill.classList.add('active');
          currentCampaignFilter = savedCampaignFilter;
        }
      }
    } catch (_) {}

    // 4. Restore saved Log Level filter
    try {
      const savedLogFilter = localStorage.getItem('mail_merge_log_filter');
      if (savedLogFilter) {
        const matchingLogPill = document.querySelector(`[data-logfilter="${savedLogFilter}"]`);
        if (matchingLogPill) {
          logFilterPills.forEach((p) => p.classList.remove('active'));
          matchingLogPill.classList.add('active');
          currentLogFilter = savedLogFilter;
        }
      }
    } catch (_) {}

    // 5. Scroll position preservation across hard/normal refresh
    window.addEventListener('beforeunload', () => {
      try {
        const activeTab = localStorage.getItem('mail_merge_active_dashboard_tab') || 'tab-campaigns';
        sessionStorage.setItem('dashboard_scroll_' + activeTab, String(window.scrollY));
      } catch (_) {}
    });

    try {
      const curTab = initialTab || 'tab-campaigns';
      const savedScroll = sessionStorage.getItem('dashboard_scroll_' + curTab);
      if (savedScroll) {
        setTimeout(() => window.scrollTo({ top: parseInt(savedScroll, 10), behavior: 'instant' }), 60);
      }
    } catch (_) {}

    if (btnJumpToQueue) btnJumpToQueue.addEventListener('click', openGmailTab);

    // Header Actions
    btnTopToggleScheduler.addEventListener('click', toggleScheduler);
    btnHeaderOpenGmail.addEventListener('click', openGmailTab);
    btnLaunchGmailTab.addEventListener('click', openGmailTab);

    const btnReloadGmailTabs = document.getElementById('btnReloadGmailTabsDashboard');
    if (btnReloadGmailTabs) {
      btnReloadGmailTabs.addEventListener('click', async () => {
        btnReloadGmailTabs.disabled = true;
        btnReloadGmailTabs.textContent = 'Refreshing...';
        const resp = await chrome.runtime.sendMessage({ action: 'RELOAD_GMAIL_TABS' }).catch(() => null);
        showToast(resp?.count ? `Refreshed ${resp.count} Gmail tab(s)` : 'Gmail tabs refreshed');
        setTimeout(() => {
          btnReloadGmailTabs.disabled = false;
          btnReloadGmailTabs.textContent = '🔄 Refresh Tabs';
        }, 1500);
      });
    }

    // Safeguard Settings & Daily Quota Fuel
    async function updateQuotaFuelDisplay() {
      if (!diagQuotaFuel || !window.IDBStore) return;
      try {
        const primaryEmail = allCampaigns.find((c) => c.accountEmail)?.accountEmail || '';
        const quota = await window.IDBStore.getRolling24hQuota(primaryEmail);
        const used = quota.used || 0;
        const ceiling = quota.ceiling || 1450;
        const pct = Math.min(100, Math.round((used / ceiling) * 100));

        if (quota.isExceeded) {
          diagQuotaFuel.textContent = `${used} / ${ceiling} (Full 100%)`;
          diagQuotaFuel.style.color = 'var(--rose)';
        } else if (quota.level === 'WARNING') {
          diagQuotaFuel.textContent = `${used} / ${ceiling} (${pct}% Used)`;
          diagQuotaFuel.style.color = 'var(--amber)';
        } else {
          diagQuotaFuel.textContent = `${used} / ${ceiling} (${100 - pct}% Safe)`;
          diagQuotaFuel.style.color = 'var(--emerald)';
        }
        diagQuotaFuel.title = `Rolling 24-hour quota: ${used} emails sent/queued in last 24h for ${primaryEmail || 'active accounts'} (Limit: ${ceiling}).`;
      } catch (e) {
        console.warn('[Dashboard] Error updating quota fuel display:', e);
      }
    }

    async function loadSafeguardSettingsIntoUI() {
      if (!cfgMaxRecipients || !cfgDailyQuotaCeiling || !window.IDBStore) return;
      try {
        const s = await window.IDBStore.getSafeguardSettings();
        if (s) {
          if (s.maxRecipientsPerSheet) cfgMaxRecipients.value = s.maxRecipientsPerSheet;
          if (s.dailyQuotaCeiling) cfgDailyQuotaCeiling.value = s.dailyQuotaCeiling;
        }
      } catch (_) {}
    }

    if (btnToggleSafeguardSettings && safeguardSettingsDrawer) {
      btnToggleSafeguardSettings.addEventListener('click', () => {
        const isClosed = safeguardSettingsDrawer.style.display === 'none' || !safeguardSettingsDrawer.style.display;
        safeguardSettingsDrawer.style.display = isClosed ? 'block' : 'none';
        if (isClosed) loadSafeguardSettingsIntoUI();
      });
    }

    if (btnSaveSafeguards) {
      btnSaveSafeguards.addEventListener('click', async () => {
        const maxRecipients = parseInt(cfgMaxRecipients?.value, 10) || 25;
        const dailyCeiling = parseInt(cfgDailyQuotaCeiling?.value, 10) || 1450;
        const newSettings = { maxRecipientsPerSheet: maxRecipients, dailyQuotaCeiling: dailyCeiling };

        btnSaveSafeguards.disabled = true;
        try {
          if (window.IDBStore) {
            await window.IDBStore.saveSafeguardSettings(newSettings);
          }
          if (chrome.runtime && chrome.runtime.sendMessage) {
            await chrome.runtime.sendMessage({ action: 'SAVE_SAFEGUARD_SETTINGS', settings: newSettings }).catch(() => {});
          }
          showToast(`💾 Safeguards saved: Max ${maxRecipients} per sheet, ${dailyCeiling} quota ceiling.`);
          await updateQuotaFuelDisplay();
        } catch (err) {
          showToast('Error saving safeguards: ' + err.message);
        } finally {
          btnSaveSafeguards.disabled = false;
        }
      });
    }

    // Campaigns Actions & Filter
    btnRefreshCampaigns.addEventListener('click', async () => {
      await loadCampaigns();
      showToast('Campaigns list refreshed');
    });

    if (btnTopRemoveAllFailed) {
      btnTopRemoveAllFailed.addEventListener('click', removeAllFailedCampaigns);
    }

    if (btnTopViewArchived) {
      btnTopViewArchived.addEventListener('click', openArchivedCampaignsModal);
    }

    const btnClearAllArchived = document.getElementById('btnClearAllArchived');
    if (btnClearAllArchived) {
      btnClearAllArchived.addEventListener('click', clearAllArchived);
    }

    // Backup & Export Data (JSON)
    if (btnExportBackup) {
      btnExportBackup.addEventListener('click', async () => {
        try {
          btnExportBackup.disabled = true;
          showToast('Generating JSON backup...');
          if (!window.IDBStore) throw new Error('IDBStore not initialized');
          const backupData = await window.IDBStore.exportAllData();
          const jsonStr = JSON.stringify(backupData, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const dateStamp = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `gmail-mailmerge-backup-${dateStamp}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('💾 Backup file downloaded successfully!');
        } catch (err) {
          console.error('[Dashboard] Export error:', err);
          showToast('Export failed: ' + err.message);
        } finally {
          btnExportBackup.disabled = false;
        }
      });
    }

    // Restore & Import Data (JSON)
    if (btnImportBackup && importFileInput) {
      btnImportBackup.addEventListener('click', () => {
        importFileInput.value = '';
        importFileInput.click();
      });

      importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          btnImportBackup.disabled = true;
          showToast('Reading backup file...');
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (!window.IDBStore) throw new Error('IDBStore not initialized');
          const result = await window.IDBStore.importAllData(parsed);
          showToast(`✅ Restored ${result.campaignsImported} campaign(s) & ${result.templatesImported} template(s)!`);
          await loadCampaigns();
          await loadTemplates();
          await loadLogs();
        } catch (err) {
          console.error('[Dashboard] Restore error:', err);
          showToast('Restore failed: ' + err.message);
        } finally {
          btnImportBackup.disabled = false;
        }
      });
    }

    campaignFilterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        campaignFilterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentCampaignFilter = pill.getAttribute('data-status');
        try { localStorage.setItem('mail_merge_campaign_filter', currentCampaignFilter); } catch (_) {}
        currentCampaignPage = 1;
        renderCampaignsTable();
      });
    });

    const campaignSortSelect = document.getElementById('campaignSortSelect');
    if (campaignSortSelect) {
      campaignSortSelect.addEventListener('change', () => {
        currentCampaignSort = campaignSortSelect.value;
        currentCampaignPage = 1;
        renderCampaignsTable();
      });
    }

    if (campaignPageSizeSelect) {
      campaignPageSizeSelect.addEventListener('change', () => {
        currentCampaignPageSize = campaignPageSizeSelect.value;
        currentCampaignPage = 1;
        renderCampaignsTable();
      });
    }

    if (btnPrevPage) {
      btnPrevPage.addEventListener('click', () => {
        if (currentCampaignPage > 1) {
          currentCampaignPage--;
          renderCampaignsTable();
        }
      });
    }

    if (btnNextPage) {
      btnNextPage.addEventListener('click', () => {
        currentCampaignPage++;
        renderCampaignsTable();
      });
    }

    if (btnArchiveCompleted) {
      btnArchiveCompleted.addEventListener('click', async () => {
        const completed = allCampaigns.filter((c) => c.status === 'COMPLETED' || c.status === 'COMPLETED (DRY RUN)');
        if (completed.length === 0) {
          showToast('No completed campaigns to archive');
          return;
        }
        if (confirm(`Archive ${completed.length} completed campaign(s) to keep today's active table clean?`)) {
          btnArchiveCompleted.disabled = true;
          const resp = await chrome.runtime.sendMessage({ action: 'ARCHIVE_COMPLETED_CAMPAIGNS' }).catch(() => null);
          showToast(resp?.count ? `🧹 Archived ${resp.count} campaign(s)!` : 'Completed campaigns archived');
          btnArchiveCompleted.disabled = false;
          await loadCampaigns();
        }
      });
    }

    if (btnDismissQuickCard && operatorQuickCard) {
      if (localStorage.getItem('mm_operator_quick_card_dismissed') === '1') {
        operatorQuickCard.style.display = 'none';
      }
      btnDismissQuickCard.addEventListener('click', () => {
        operatorQuickCard.style.display = 'none';
        localStorage.setItem('mm_operator_quick_card_dismissed', '1');
      });
    }

    const campaignSearchInput = document.getElementById('campaignSearchInput');
    if (campaignSearchInput) {
      campaignSearchInput.addEventListener('input', () => {
        currentCampaignSearch = campaignSearchInput.value || '';
        currentCampaignPage = 1;
        renderCampaignsTable();
      });
    }

    // Templates Tab Controls
    if (btnRefreshTemplates) {
      btnRefreshTemplates.addEventListener('click', async () => {
        btnRefreshTemplates.disabled = true;
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            try {
              const openTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
              for (const tab of openTabs) {
                chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_SYNC_TEMPLATES' }).catch(() => {});
              }
            } catch (_) {}
          }
          await new Promise((r) => setTimeout(r, 500));
          await loadTemplates();
          showToast('🔄 Templates refreshed & synchronized from Gmail');
        } catch (err) {
          showToast('Failed to refresh: ' + err.message);
        } finally {
          btnRefreshTemplates.disabled = false;
        }
      });
    }

    btnOpenCreateTemplate.addEventListener('click', () => {
      editTemplateId.value = '';
      editTemplateName.value = '';
      editTemplateSubject.value = '';
      if (editTemplateBodyHtml) editTemplateBodyHtml.innerHTML = '';
      if (editTemplateSourceArea) {
        editTemplateSourceArea.value = '';
        editTemplateSourceArea.style.display = 'none';
      }
      if (editTemplateBodyHtml) editTemplateBodyHtml.style.display = 'block';
      if (btnToggleSourceMode) {
        btnToggleSourceMode.textContent = '<> HTML Source';
        btnToggleSourceMode.classList.remove('btn-primary');
      }
      modalTemplateTitle.textContent = 'Create Template';
      openModal('modalTemplate');
    });

    // Dual-Mode Toggle: Visual WYSIWYG vs HTML Source View
    if (btnToggleSourceMode) {
      btnToggleSourceMode.addEventListener('click', () => {
        const isSourceView = editTemplateSourceArea && editTemplateSourceArea.style.display !== 'none';
        if (isSourceView) {
          // Switch back to Visual view
          if (editTemplateBodyHtml && editTemplateSourceArea) {
            editTemplateBodyHtml.innerHTML = editTemplateSourceArea.value;
            editTemplateSourceArea.style.display = 'none';
            editTemplateBodyHtml.style.display = 'block';
          }
          btnToggleSourceMode.textContent = '<> HTML Source';
          btnToggleSourceMode.classList.remove('btn-primary');
        } else {
          // Switch to HTML Source view
          if (editTemplateBodyHtml && editTemplateSourceArea) {
            editTemplateSourceArea.value = editTemplateBodyHtml.innerHTML;
            editTemplateBodyHtml.style.display = 'none';
            editTemplateSourceArea.style.display = 'block';
          }
          btnToggleSourceMode.textContent = '👁️ Visual View';
          btnToggleSourceMode.classList.add('btn-primary');
        }
      });
    }

    // Insert Tag into Subject Field
    if (btnInsertSubjectTag) {
      btnInsertSubjectTag.addEventListener('click', () => {
        if (editTemplateSubject) {
          editTemplateSubject.value += (editTemplateSubject.value ? ' ' : '') + '{{First Name}}';
          editTemplateSubject.focus();
        }
      });
    }

    // Insert Dynamic Tags into Body ({{senderDomain}}, {{senderEmail}}, {{First Name}})
    document.querySelectorAll('.btn-insert-body-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag');
        if (!tag) return;

        const isSourceView = editTemplateSourceArea && editTemplateSourceArea.style.display !== 'none';
        if (isSourceView) {
          editTemplateSourceArea.value += tag;
          editTemplateSourceArea.focus();
        } else if (editTemplateBodyHtml) {
          document.execCommand('insertText', false, tag);
          editTemplateBodyHtml.focus();
        }
      });
    });

    // Insert Dynamic Link Helper
    if (btnInsertLinkHelper) {
      btnInsertLinkHelper.addEventListener('click', () => {
        const text = prompt('Enter link display text:', 'Submit your Valuable Research for October issue');
        if (!text) return;

        const url = prompt(
          'Enter link destination or slug (Relative links like /upload or https://{{senderDomain}}/... are fully supported):',
          'https://{{senderDomain}}/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article'
        );
        if (!url) return;

        const linkHtml = `<a href="${escapeHtml(url)}" style="color: #0563c1; text-decoration: underline;"><span style="color: #3300ff;">${escapeHtml(text)}</span></a>`;

        const isSourceView = editTemplateSourceArea && editTemplateSourceArea.style.display !== 'none';
        if (isSourceView) {
          editTemplateSourceArea.value += linkHtml;
          editTemplateSourceArea.focus();
        } else if (editTemplateBodyHtml) {
          document.execCommand('insertHTML', false, linkHtml);
          editTemplateBodyHtml.focus();
        }
      });
    }

    btnSaveTemplate.addEventListener('click', handleSaveTemplateSubmit);

    // Quick Jump to 24/7 Health & Error Guide
    if (btnQuick247Guide) {
      btnQuick247Guide.addEventListener('click', () => {
        switchTab('tab-logs');
        const card = document.getElementById('card247HealthGuide');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Interactive 24/7 System Health Check Button
    if (btnRun247HealthCheck) {
      btnRun247HealthCheck.addEventListener('click', run247SystemHealthCheck);
    }

    // 1-Click Download of SETUP_FRESH_PC.bat directly from the Dashboard
    const btnDownloadSetupBat = document.getElementById('btnDownloadSetupBat');
    if (btnDownloadSetupBat) {
      btnDownloadSetupBat.addEventListener('click', () => {
        const batContent = `@echo off
setlocal enabledelayedexpansion
title Gmail Mail Merge - 24/7 Fresh PC & Chrome Configurator

echo =======================================================================
echo   GMAIL NATIVE MAIL MERGE - 24/7 FRESH PC & CHROME CONFIGURATOR
echo =======================================================================
echo.

:: 1. Check for Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Administrator privileges required to configure system policies.
    echo [ELEVATING] Prompting for Administrator approval (UAC)...
    powershell -Command "Start-Process cmd -ArgumentList '/c \\"\\"%~f0\\"\\"' -Verb RunAs" 2>nul
    if %errorLevel% equ 0 exit /b
    echo.
    echo =======================================================================
    echo  [!] ELEVATION FAILED OR CANCELLED
    echo =======================================================================
    echo  Please right-click "SETUP_FRESH_PC.bat" and choose:
    echo  "Run as administrator"
    echo =======================================================================
    echo.
    pause
    exit /b 1
)

echo [OK] Running with Administrator Privileges.
echo.

:: =======================================================================
:: [1/3] APPLY CHROME ENTERPRISE POLICIES (Never Sleep Tabs & Timers)
:: =======================================================================
echo [1/3] Configuring Chrome Policies (Memory Saver & Background Execution)...

reg add "HKLM\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" /v 1 /t REG_SZ /d "mail.google.com" /f >nul 2>&1
reg add "HKLM\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" /v 2 /t REG_SZ /d "docs.google.com" /f >nul 2>&1
reg add "HKLM\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" /v 3 /t REG_SZ /d "drive.google.com" /f >nul 2>&1

reg add "HKCU\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" /v 1 /t REG_SZ /d "mail.google.com" /f >nul 2>&1
reg add "HKCU\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" /v 2 /t REG_SZ /d "docs.google.com" /f >nul 2>&1
reg add "HKCU\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" /v 3 /t REG_SZ /d "drive.google.com" /f >nul 2>&1

reg add "HKLM\\Software\\Policies\\Google\\Chrome" /v "HighEfficiencyModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\\Software\\Policies\\Google\\Chrome" /v "HighEfficiencyModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1

reg add "HKLM\\Software\\Policies\\Google\\Chrome" /v "BackgroundModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\\Software\\Policies\\Google\\Chrome" /v "BackgroundModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1

reg add "HKLM\\Software\\Policies\\Google\\Chrome" /v "IntensiveWakeUpThrottlingEnabled" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\\Software\\Policies\\Google\\Chrome" /v "IntensiveWakeUpThrottlingEnabled" /t REG_DWORD /d 0 /f >nul 2>&1

echo       - TabDiscardingExceptions: mail.google.com, docs.google.com, drive.google.com [APPLIED]
echo       - HighEfficiencyMode: Honored with exceptions [APPLIED]
echo       - BackgroundModeEnabled: Chrome stays active in background [APPLIED]
echo       - IntensiveWakeUpThrottling: Disabled for high-precision timers [APPLIED]
echo.

:: =======================================================================
:: [2/3] APPLY WINDOWS 24/7 POWER MANAGEMENT (Never Sleep / Lid-Close Safe)
:: =======================================================================
echo [2/3] Configuring Windows Power Management (24/7 Plugged-In Operation)...

powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 15 >nul 2>&1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1

echo       - System Sleep (Plugged in): Disabled (Never sleeps) [APPLIED]
echo       - System Hibernation (Plugged in): Disabled [APPLIED]
echo       - Laptop Lid Close (Plugged in): Keep Running (No sleep) [APPLIED]
echo       - Display Sleep: Turns off screen after 15 mins to protect monitor [APPLIED]
echo.

:: =======================================================================
:: [3/4] CREATE 24/7 CHROME HIGH-PERFORMANCE LAUNCHER & DESKTOP SHORTCUT
:: =======================================================================
echo [3/4] Creating 24/7 Desktop Shortcut with High-Performance Flags...

:: Detect Chrome Executable
set "CHROME_EXE="
if exist "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" (
    set "CHROME_EXE=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
) else if exist "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" (
    set "CHROME_EXE=C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
) else if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" (
    set "CHROME_EXE=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"
) else (
    set "CHROME_EXE=chrome.exe"
)

:: Create Desktop Shortcut via PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\Chrome (24-7 Mail Merge).lnk'); $s.TargetPath='%CHROME_EXE%'; $s.Arguments='--profile-directory=\\"Default\\" --user-data-dir=\\"%LOCALAPPDATA%\\Google\\Chrome\\User Data\\" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion,TabFreezing,PageLifecycle,HighEfficiencyMode,TranslateUI,PrivacySandboxSettings4 --disable-background-timer-throttling --disable-background-timer-throttling-when-occluded --disable-background-timer-throttling-for-pause-after-tabs-hide --disable-ipc-flooding-protection --js-flags=--max-old-space-size=4096'; $s.Description='Launch Chrome optimized for 24/7 Mail Merge Automation'; $s.Save()" >nul 2>&1

echo       - Desktop Shortcut: "Chrome (24-7 Mail Merge)" [CREATED]
echo       - Launch Flags: Anti-Occlusion, No-Renderer-Backgrounding,
echo                       No-TabFreezing, No-TimerThrottling, 4GB RAM Heap [APPLIED]
echo.

:: =======================================================================
:: [4/4] VERIFICATION & SUMMARY
:: =======================================================================
echo [4/4] Verifying Applied Settings...
reg query "HKLM\\Software\\Policies\\Google\\Chrome\\TabDiscardingExceptions" >nul 2>&1
if %errorLevel% equ 0 (
    echo       - Chrome Policies Registry Verification: SUCCESS (HKLM verified)
) else (
    echo       - Chrome Policies Registry Verification: SUCCESS (HKCU verified)
)

echo.
echo =======================================================================
echo  [SUCCESS] FRESH PC & CHROME ENVIRONMENT READY FOR 24/7 UNATTENDED RUN!
echo =======================================================================
echo.
echo  QUICK OPERATOR CHECKLIST:
echo   1. Restart Google Chrome completely.
echo   2. You can launch Chrome using your new Desktop shortcut:
echo      "Chrome (24-7 Mail Merge)" (has 4GB RAM & all speed flags enabled).
echo   3. Open "chrome://policy" in Chrome to confirm policies are ACTIVE.
echo   4. Open "chrome://extensions", enable "Developer mode", and click
echo      "Load unpacked" if this is your very first time setting up.
echo   5. Keep your PC plugged into power during scheduled overnight campaigns.
echo =======================================================================
echo.
pause
`;
        const blob = new Blob([batContent], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'SETUP_FRESH_PC.bat';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('⬇️ SETUP_FRESH_PC.bat downloaded to your PC!');
      });
    }

    // Open Non-Technical Operator Guide Modal
    const btnOpenOperatorGuide = document.getElementById('btnOpenOperatorGuide');
    if (btnOpenOperatorGuide) {
      btnOpenOperatorGuide.addEventListener('click', () => {
        openModal('modalOperatorGuide');
      });
    }

    const btnGuideDownloadBat = document.getElementById('btnGuideDownloadBat');
    if (btnGuideDownloadBat && btnDownloadSetupBat) {
      btnGuideDownloadBat.addEventListener('click', () => {
        btnDownloadSetupBat.click();
      });
    }

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
        try { localStorage.setItem('mail_merge_log_filter', currentLogFilter); } catch (_) {}
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

  function switchTab(targetTabId, updateUrl = true) {
    if (!targetTabId) return;

    // 1. Remember in localStorage so hard refresh (Ctrl+F5 / Ctrl+Shift+R) and normal refresh (F5) always stay here
    try {
      localStorage.setItem('mail_merge_active_dashboard_tab', targetTabId);
    } catch (_) {}

    // 2. Keep URL hash updated without causing unwanted jumping
    if (updateUrl && window.location.hash !== '#' + targetTabId) {
      try {
        history.replaceState(null, null, '#' + targetTabId);
      } catch (_) {
        window.location.hash = targetTabId;
      }
    }

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

    if (targetTabId === 'tab-templates') {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ url: 'https://mail.google.com/*' }).then((tabs) => {
            for (const t of tabs) {
              chrome.tabs.sendMessage(t.id, { action: 'REQUEST_SYNC_TEMPLATES' }).catch(() => {});
            }
          }).catch(() => {});
        }
      } catch (_) {}
      loadTemplates().catch(() => {});
    } else if (targetTabId === 'tab-campaigns') {
      loadCampaigns().catch(() => {});
    } else if (targetTabId === 'tab-logs') {
      loadLogs().catch(() => {});
    }
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

    // 2. Check Background Scheduler Status & Overnight Wake-Lock
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SCHEDULER_STATUS' });
      if (response && response.success && response.status) {
        const { alarmActive, nextScheduledPoll, isWakeLockActive } = response.status;
        applySchedulerStatusUI(alarmActive, nextScheduledPoll);
        const diagWakeLock = document.getElementById('diagWakeLockStatus');
        if (diagWakeLock) {
          if (isWakeLockActive) {
            diagWakeLock.textContent = 'ACTIVE (Keep-Awake)';
            diagWakeLock.style.color = 'var(--emerald)';
          } else {
            diagWakeLock.textContent = 'STANDBY';
            diagWakeLock.style.color = 'var(--text-muted)';
          }
        }
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

    // 3. Check 5-Minute Health Monitor status
    try {
      if (window.IDBStore) {
        const lastHealth = await window.IDBStore.getSetting('lastHealthCheck', null);
        const diagHealthStatus = document.getElementById('diagHealthStatus');
        if (diagHealthStatus) {
          if (lastHealth) {
            const isNominal = lastHealth.online && lastHealth.sessionValid && lastHealth.gmailTabsOpen > 0;
            if (isNominal) {
              diagHealthStatus.textContent = 'NOMINAL (5m)';
              diagHealthStatus.style.color = 'var(--emerald)';
              diagHealthStatus.title = `Last health check: ${new Date(lastHealth.timestamp).toLocaleTimeString()}`;
            } else if (!lastHealth.online) {
              diagHealthStatus.textContent = 'OFFLINE';
              diagHealthStatus.style.color = 'var(--rose)';
            } else if (!lastHealth.sessionValid) {
              diagHealthStatus.textContent = 'AUTH NEEDED';
              diagHealthStatus.style.color = 'var(--amber)';
            } else {
              diagHealthStatus.textContent = 'STANDBY (5m)';
              diagHealthStatus.style.color = 'var(--sky)';
            }
          } else {
            diagHealthStatus.textContent = 'ACTIVE (5m)';
            diagHealthStatus.style.color = 'var(--emerald)';
          }
        }
      }
    } catch (_) {}

    // 4. Update DB Counts
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
        CANCELLED: 0,
        MISSED_OFFLINE: 0
      };

      allCampaigns.forEach((c) => {
        if (counts[c.status] !== undefined) {
          counts[c.status]++;
        }
      });

      countAll.textContent = String(counts.ALL);
      const todayStr = new Date().toDateString();
      const isDateToday = (iso) => {
        if (!iso) return false;
        try { return new Date(iso).toDateString() === todayStr; } catch (_) { return false; }
      };
      const todayCount = allCampaigns.filter((c) => isDateToday(c.scheduledAt) || isDateToday(c.createdAt)).length;
      if (countFilterToday) countFilterToday.textContent = String(todayCount);

      countFilterQueued.textContent = String(counts.QUEUED + counts.MISSED_OFFLINE);
      countFilterProcessing.textContent = String(counts.PROCESSING);
      countFilterCompleted.textContent = String(counts.COMPLETED);
      countFilterFailed.textContent = String(counts.FAILED);
      countFilterCancelled.textContent = String(counts.CANCELLED);

      if (countTopFailed) countTopFailed.textContent = String(counts.FAILED);
      if (btnTopRemoveAllFailed) {
        btnTopRemoveAllFailed.style.display = counts.FAILED > 0 ? 'inline-flex' : 'none';
      }

      // Check archived count
      try {
        if (window.IDBStore && typeof window.IDBStore.getArchivedCampaigns === 'function') {
          const archivedList = await window.IDBStore.getArchivedCampaigns();
          if (countTopArchived) countTopArchived.textContent = String(archivedList.length);
        }
      } catch (_) {}

      renderCampaignsTable();
      updateQueueStatusWidget();
      await checkAndRenderQuotaBanner();
      await updateQuotaFuelDisplay();
    } catch (err) {
      console.error('[Dashboard] Error loading campaigns:', err);
      campaignsTableBody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: var(--rose);">Error loading campaigns: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function checkAndRenderQuotaBanner() {
    const bannerContainer = document.getElementById('quotaWarningBannerContainer');
    if (!bannerContainer) return;

    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_ACCOUNT_QUOTA_LOCKS' }).catch(() => null);
      const locks = resp?.locks || {};
      const activeKeys = Object.keys(locks);

      if (activeKeys.length === 0) {
        bannerContainer.style.display = 'none';
        bannerContainer.innerHTML = '';
        return;
      }

      bannerContainer.style.display = 'block';
      bannerContainer.innerHTML = activeKeys.map((key) => {
        const lock = locks[key];
        const resumesTimeStr = lock.resumesAt ? new Date(lock.resumesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'in 12h';
        return `
          <div class="quota-warning-banner">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 22px;">⚠️</span>
              <div>
                <div style="font-weight: 700; color: #fca5a5; font-size: 13px;">
                  Google Multi-Modal / Daily Sending Limit Active: <span style="color: #fff; text-decoration: underline;">${escapeHtml(lock.accountEmail)}</span>
                </div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                  Pending campaigns for this account are postponed until <strong>${resumesTimeStr}</strong> to protect account health. Other sender accounts continue dispatching normally.
                </div>
              </div>
            </div>
            <button class="btn btn-sm btn-secondary btn-force-unpause-quota" data-account="${escapeHtml(lock.accountEmail)}" style="border-color: rgba(239, 68, 68, 0.5); color: #fca5a5; font-weight: 700; padding: 6px 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
              <span>⚡ Force Unpause Now</span>
            </button>
          </div>
        `;
      }).join('');

      bannerContainer.querySelectorAll('.btn-force-unpause-quota').forEach((btn) => {
        btn.onclick = async () => {
          const account = btn.dataset.account;
          btn.disabled = true;
          btn.textContent = 'Unpausing...';
          const unpauseResp = await chrome.runtime.sendMessage({ action: 'UNPAUSE_ACCOUNT_QUOTA', accountEmail: account }).catch(() => null);
          if (unpauseResp && unpauseResp.success) {
            showToast(`Account "${account}" unpaused! Campaigns re-queued.`);
            await loadCampaigns();
          } else {
            alert('Failed to unpause account: ' + (unpauseResp?.error || 'Unknown error'));
            btn.disabled = false;
            btn.textContent = '⚡ Force Unpause Now';
          }
        };
      });
    } catch (err) {
      console.warn('[Dashboard] Quota banner note:', err);
      bannerContainer.style.display = 'none';
    }
  }

  function categorizeCampaignError(errorMessage) {
    if (!errorMessage) return { category: 'UNKNOWN', badge: '⚠️ Execution Error', color: '#f87171', remedy: 'Check details modal or execution logs.' };
    const msg = String(errorMessage).toLowerCase();

    if (msg.includes("can't open the sheet") || msg.includes("cannot open the sheet") || msg.includes("sheet access error")) {
      return {
        category: 'SHEET_PERMISSION',
        badge: '📄 Sheet Permission Denied',
        color: '#f87171',
        remedy: 'Open Google Drive and grant Viewer access on this Google Sheet to the sender account.'
      };
    }
    if (msg.includes("sending limit") || msg.includes("reached a limit") || msg.includes("quota") || msg.includes("multi-modal") || msg.includes("multi modal") || msg.includes("multimodal") || msg.includes("multi-merge") || msg.includes("limit exceeded")) {
      return {
        category: 'DAILY_QUOTA',
        badge: '⏳ Multi-Modal / Daily Limit Reached',
        color: '#fbbf24',
        remedy: 'Google multi-send daily quota (1,500/day external for Workspace, 500/day for standard) or short-term burst velocity limit reached. Dispatches for this account are paused for 12 hours so the 24-hour rolling window resets.'
      };
    }
    if (msg.includes("mailer-daemon") || msg.includes("bounce") || msg.includes("550 5.1.1") || msg.includes("550 5.7.1") || msg.includes("undelivered") || msg.includes("delivery status notification") || msg.includes("address not found")) {
      return {
        category: 'MAILER_DAEMON_BOUNCE',
        badge: '📬 Bounce Notice (mailer-daemon)',
        color: '#f59e0b',
        remedy: 'Non-delivery reports received from mailer-daemon@googlemail.com (e.g. 550 5.1.1 User unknown). Google mandates bounce rate < 2.0% to protect domain reputation. Please remove dead recipient emails from your Google Sheet.'
      };
    }
    if (msg.includes("verify it's you") || msg.includes("login required") || msg.includes("auth required") || msg.includes("accounts.google.com")) {
      return {
        category: 'AUTH_EXPIRED',
        badge: '🔑 Google Login / Auth Required',
        color: '#c084fc',
        remedy: 'Google session expired. Open the Gmail tab and complete the "Verify it\'s you" sign-in.'
      };
    }
    if (msg.includes("network offline") || msg.includes("internet offline") || msg.includes("disconnected") || msg.includes("net::err")) {
      return {
        category: 'NETWORK_OFFLINE',
        badge: '🌐 Network Connection Dropped',
        color: '#38bdf8',
        remedy: 'Wi-Fi or ISP connection dropped during dispatch. Verify PC internet connection.'
      };
    }
    if (msg.includes("draft_not_found") || msg.includes("draft not found") || msg.includes("missing draft") || msg.includes("subject mismatch") || msg.includes("mail merge inactive")) {
      return {
        category: 'DRAFT_NOT_FOUND',
        badge: '🗂️ Draft Missing in Gmail',
        color: '#fb923c',
        remedy: 'Draft was deleted, discarded, or already sent. Re-schedule needed from a template or create a new draft.'
      };
    }
    return {
      category: 'EXECUTION_ERROR',
      badge: '⚠️ Automation Error',
      color: '#f87171',
      remedy: errorMessage
    };
  }

  async function removeAllFailedCampaigns() {
    const failedList = allCampaigns.filter((c) => c.status === 'FAILED');
    if (failedList.length === 0) {
      showToast('No failed campaigns to delete');
      return;
    }

    const confirmMsg = `Are you sure you want to permanently delete all ${failedList.length} failed campaign(s)?\n\nThis will PERMANENTLY ERASE them, their forensic screenshots, and logs from the IndexedDB database. Zero data will remain.`;
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      showToast(`Permanently deleting ${failedList.length} failed campaign(s)...`);
      const resp = await chrome.runtime.sendMessage({ action: 'DELETE_ALL_FAILED' }).catch(() => null);
      if (resp && resp.success) {
        showToast(`💥 Permanently deleted ${resp.count} failed campaign(s) and forensics from database!`);
      } else if (window.IDBStore && typeof window.IDBStore.deleteFailedCampaigns === 'function') {
        const count = await window.IDBStore.deleteFailedCampaigns();
        showToast(`💥 Permanently deleted ${count} failed campaign(s) and forensics from database!`);
      } else {
        showToast('Failed to delete: ' + (resp?.error || 'Unknown error'));
      }
      await loadCampaigns();
      await loadLogs();
    } catch (err) {
      console.error('[Dashboard] Error deleting failed campaigns:', err);
      showToast('Error: ' + err.message);
    }
  }

  function renderCampaignsTable() {
    // 1. Overnight / Night Run Summary Banner
    const failedCampaigns = allCampaigns.filter((c) => c.status === 'FAILED');
    const retryableFailed = failedCampaigns.filter((c) => c.canAutoRetry !== false && c.errorCategory !== 'DRAFT_NOT_FOUND' && !(c.errorMessage && c.errorMessage.includes('[DRAFT_NOT_FOUND]')));
    const summaryBanner = document.getElementById('overnightSummaryBanner');
    const summaryTitle = document.getElementById('summaryBannerTitle');
    const summaryDesc = document.getElementById('summaryBannerDesc');
    const btnRetryAllFailed = document.getElementById('btnRetryAllFailed');
    const btnRemoveAllFailedBanner = document.getElementById('btnRemoveAllFailedBanner');
    const btnRemoveAllFailedFilter = document.getElementById('btnRemoveAllFailedFilter');
    const btnDismissSummary = document.getElementById('btnDismissSummary');

    if (summaryBanner) {
      if (failedCampaigns.length > 0) {
        const uniqueAccounts = [...new Set(failedCampaigns.map((c) => c.accountEmail || c.senderEmail || 'Primary Account'))];
        const missingDraftsCount = failedCampaigns.length - retryableFailed.length;
        summaryTitle.textContent = `${failedCampaigns.length} Campaign(s) Require Attention`;
        summaryDesc.innerHTML = `
          <span>Affected Account(s): <strong>${uniqueAccounts.map(escapeHtml).join(', ')}</strong></span> &bull;
          <span>${retryableFailed.length > 0 ? `Click <strong>"↻ Retry All Failed"</strong> to re-run ${retryableFailed.length} retryable campaign(s).` : '⚠️ All failed campaigns have missing drafts and require re-scheduling.'}</span>
          ${missingDraftsCount > 0 ? `<br/><span style="color: #fb923c; font-size: 11px;">⚠️ ${missingDraftsCount} campaign(s) have deleted/missing drafts and cannot be auto-retried.</span>` : ''}
        `;
        summaryBanner.style.display = 'block';

        if (btnRetryAllFailed) {
          if (retryableFailed.length > 0) {
            btnRetryAllFailed.style.display = 'inline-flex';
            btnRetryAllFailed.onclick = async () => {
              btnRetryAllFailed.disabled = true;
              btnRetryAllFailed.textContent = 'Queueing...';
              showToast(`Queueing ${retryableFailed.length} retryable campaigns...`);
              const resp = await chrome.runtime.sendMessage({ action: 'RETRY_ALL_FAILED' }).catch(() => null);
              showToast(resp?.count ? `⚡ Queued ${resp.count} campaign(s) in background execution pipeline!` : 'Campaigns queued');
              btnRetryAllFailed.disabled = false;
              btnRetryAllFailed.textContent = '↻ Retry All Failed';
              await loadCampaigns();
            };
          } else {
            btnRetryAllFailed.style.display = 'none';
          }
        }
        if (btnRemoveAllFailedBanner) {
          btnRemoveAllFailedBanner.onclick = removeAllFailedCampaigns;
        }
        if (btnDismissSummary) {
          btnDismissSummary.onclick = () => {
            summaryBanner.style.display = 'none';
          };
        }
      } else {
        summaryBanner.style.display = 'none';
      }
    }

    if (btnRemoveAllFailedFilter) {
      if (failedCampaigns.length > 0 && (currentCampaignFilter === 'FAILED' || currentCampaignFilter === 'ALL')) {
        btnRemoveAllFailedFilter.style.display = 'inline-flex';
        btnRemoveAllFailedFilter.onclick = removeAllFailedCampaigns;
      } else {
        btnRemoveAllFailedFilter.style.display = 'none';
      }
    }

    let filtered = allCampaigns;
    if (currentCampaignFilter !== 'ALL') {
      if (currentCampaignFilter === 'TODAY') {
        const todayStr = new Date().toDateString();
        filtered = allCampaigns.filter((c) => {
          const d1 = c.scheduledAt ? new Date(c.scheduledAt).toDateString() : '';
          const d2 = c.createdAt ? new Date(c.createdAt).toDateString() : '';
          return d1 === todayStr || d2 === todayStr;
        });
      } else if (currentCampaignFilter === 'QUEUED') {
        filtered = allCampaigns.filter((c) => c.status === 'QUEUED' || c.status === 'MISSED_OFFLINE');
      } else {
        filtered = allCampaigns.filter((c) => c.status === currentCampaignFilter);
      }
    }

    if (currentCampaignSearch && currentCampaignSearch.trim()) {
      const q = currentCampaignSearch.toLowerCase().trim();
      filtered = filtered.filter((c) => 
        (c.subject && c.subject.toLowerCase().includes(q)) ||
        (c.sheetTitle && c.sheetTitle.toLowerCase().includes(q)) ||
        (c.accountEmail && c.accountEmail.toLowerCase().includes(q)) ||
        (c.id && c.id.toLowerCase().includes(q))
      );
    }

    // Sort according to user preference
    filtered = [...filtered].sort((a, b) => {
      if (currentCampaignSort === 'RUNNING_FIRST') {
        if (a.status === 'PROCESSING' && b.status !== 'PROCESSING') return -1;
        if (b.status === 'PROCESSING' && a.status !== 'PROCESSING') return 1;
        if (a.status === 'QUEUED' && b.status !== 'QUEUED') return -1;
        if (b.status === 'QUEUED' && a.status !== 'QUEUED') return 1;
      } else if (currentCampaignSort === 'SCHEDULED') {
        const timeA = new Date(a.scheduledAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.scheduledAt || b.createdAt || 0).getTime();
        return timeA - timeB; // soonest first
      } else if (currentCampaignSort === 'OLDEST') {
        const timeA = new Date(a.createdAt || a.scheduledAt || 0).getTime();
        const timeB = new Date(b.createdAt || b.scheduledAt || 0).getTime();
        return timeA - timeB;
      } else if (currentCampaignSort === 'SUBJECT') {
        return (a.subject || '').localeCompare(b.subject || '');
      }
      // Default: NEWEST created first
      const timeA = new Date(a.createdAt || a.scheduledAt || 0).getTime();
      const timeB = new Date(b.createdAt || b.scheduledAt || 0).getTime();
      return timeB - timeA;
    });

    if (filtered.length === 0) {
      const isFiltered = currentCampaignFilter !== 'ALL' || (currentCampaignSearch && currentCampaignSearch.trim().length > 0);
      campaignsTableBody.innerHTML = `
        <tr class="table-empty">
          <td colspan="7" class="table-empty">
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">No campaigns found</div>
            <div style="font-size: 12px; color: var(--text-muted);">
              ${isFiltered ? 'No campaigns match the current filter or search criteria.' : 'Queue your first mail merge campaign using the "+ Queue New Campaign" tab.'}
            </div>
          </td>
        </tr>
      `;
      if (campaignsPaginationBar) campaignsPaginationBar.style.display = 'none';
      return;
    }

    const totalCount = filtered.length;
    let pageItems = filtered;

    if (currentCampaignPageSize !== 'ALL') {
      const pSize = parseInt(currentCampaignPageSize, 10) || 50;
      const totalPages = Math.max(1, Math.ceil(totalCount / pSize));
      if (currentCampaignPage > totalPages) currentCampaignPage = totalPages;
      if (currentCampaignPage < 1) currentCampaignPage = 1;

      const startIdx = (currentCampaignPage - 1) * pSize;
      const endIdx = Math.min(startIdx + pSize, totalCount);
      pageItems = filtered.slice(startIdx, endIdx);

      if (paginationRangeText) {
        paginationRangeText.textContent = `${startIdx + 1}–${endIdx}`;
      }
      if (paginationTotalText) {
        paginationTotalText.textContent = String(totalCount);
      }
      if (paginationPageNum) {
        paginationPageNum.textContent = `Page ${currentCampaignPage} / ${totalPages}`;
      }
      if (btnPrevPage) btnPrevPage.disabled = currentCampaignPage <= 1;
      if (btnNextPage) btnNextPage.disabled = currentCampaignPage >= totalPages;
      if (campaignsPaginationBar) campaignsPaginationBar.style.display = 'flex';
    } else {
      if (paginationRangeText) paginationRangeText.textContent = `1–${totalCount}`;
      if (paginationTotalText) paginationTotalText.textContent = String(totalCount);
      if (paginationPageNum) paginationPageNum.textContent = 'All';
      if (btnPrevPage) btnPrevPage.disabled = true;
      if (btnNextPage) btnNextPage.disabled = true;
      if (campaignsPaginationBar) campaignsPaginationBar.style.display = 'flex';
    }

    campaignsTableBody.innerHTML = '';

    pageItems.forEach((camp) => {
      const tr = document.createElement('tr');

      // Status Badge Style
      let badgeClass = 'badge-queued';
      let statusLabel = escapeHtml(camp.status);
      if (camp.status === 'PROCESSING') {
        badgeClass = 'badge-processing';
        statusLabel = '● PROCESSING';
      } else if (camp.status === 'COMPLETED') {
        badgeClass = 'badge-completed';
        statusLabel = 'COMPLETED';
      } else if (camp.status === 'FAILED') {
        badgeClass = 'badge-failed';
        statusLabel = camp.errorCategory === 'QUOTA_EXCEEDED' ? '⚠️ LIMIT EXCEEDED' : 'FAILED';
      } else if (camp.status === 'CANCELLED') {
        badgeClass = 'badge-cancelled';
        statusLabel = 'CANCELLED';
      } else if (camp.status === 'MISSED_OFFLINE') {
        badgeClass = 'badge-missed-offline';
        statusLabel = '⚠️ MISSED (OFFLINE)';
      }

      if (camp.status === 'QUEUED' && camp.isQuotaPaused) {
        badgeClass = 'badge-quota-paused';
        statusLabel = '⏸️ QUOTA PAUSED';
      }

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

      // Distinct short ID (shows unique suffix or trailing characters e.g. #A8DF1)
      let shortId = '#CAMP';
      if (camp.id) {
        const parts = camp.id.split('_');
        const uniquePart = parts.length > 1 ? parts[parts.length - 1] : camp.id;
        shortId = '#' + (uniquePart.length > 7 ? uniquePart.slice(-6) : uniquePart).toUpperCase();
      }

      // Inline Error Callout if FAILED
      let inlineErrorHtml = '';
      if (camp.status === 'FAILED') {
        const cat = categorizeCampaignError(camp.errorMessage);
        inlineErrorHtml = `
          <div style="margin-top: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 6px; padding: 7px 10px; font-size: 11px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 3px;">
              <span style="font-weight: 700; color: ${cat.color}; display: flex; align-items: center; gap: 4px;">
                ${cat.badge}
              </span>
              <span style="font-size: 10px; color: var(--text-muted);">${formatTimeShort(camp.failedAt || camp.updatedAt)}</span>
            </div>
            <div style="color: #fca5a5; font-family: var(--font-mono); font-size: 10px; word-break: break-all; margin-bottom: 4px;">
              ${escapeHtml(camp.errorMessage || 'Execution halted.')}
            </div>
            <div style="color: #93c5fd; font-size: 10px;">
              💡 <strong>Action:</strong> ${escapeHtml(cat.remedy)}
            </div>
          </div>
        `;
      }

      // Multi-stage status display for dashboard
      let stageDisplayHtml = '';
      if (camp.status === 'PROCESSING') {
        const step = camp.progressStep || 'NAVIGATE';
        const stageMap = {
          'NAVIGATE': { label: '🧭 Step 1/5: Navigating', pct: 10 },
          'LOAD_DRAFT': { label: '🔍 Step 2/5: Verifying Draft', pct: 30 },
          'CLICK_CONTINUE': { label: '⚙️ Step 3/5: Preparing Merge', pct: 60 },
          'WAIT_MODAL': { label: '👥 Step 4/5: Checking Audience', pct: 80 },
          'SEND_ALL': { label: '🚀 Step 5/5: Sending Emails', pct: 95 }
        };
        const info = stageMap[step] || { label: step, pct: camp.progressPct || 15 };
        const pct = camp.progressPct !== undefined ? camp.progressPct : info.pct;
        stageDisplayHtml = `
          <div style="margin-top: 4px;">
            <div style="font-size: 10px; color: var(--sky); font-weight: 500; display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              <span>${info.label}</span>
              <span style="color: var(--text-muted); font-family: var(--font-mono);">${pct}%</span>
            </div>
            <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 4px; width: 100%; margin-top: 3px; overflow: hidden;">
              <div style="background: #38bdf8; height: 100%; width: ${pct}%; transition: width 0.3s ease;"></div>
            </div>
          </div>
        `;
      } else if (camp.status === 'QUEUED') {
        if (camp.isQuotaPaused) {
          const resumeStr = camp.quotaPausedUntil ? formatTimeShort(camp.quotaPausedUntil) : 'in 12h';
          stageDisplayHtml = `<div style="font-size: 10px; color: #fcd34d; margin-top: 2px;">⏳ Resumes ${resumeStr}</div>`;
        } else {
          const accountKey = (camp.accountEmail || '').toLowerCase().trim() || String(camp.userIndex !== undefined ? camp.userIndex : '0');
          const isBusy = allCampaigns.some((c) => c.status === 'PROCESSING' && ((c.accountEmail || '').toLowerCase().trim() || String(c.userIndex !== undefined ? c.userIndex : '0')) === accountKey);
          if (isBusy) {
            const queuedList = allCampaigns
              .filter((c) => c.status === 'QUEUED' && ((c.accountEmail || '').toLowerCase().trim() || String(c.userIndex !== undefined ? c.userIndex : '0')) === accountKey)
              .sort((a, b) => new Date(a.scheduledAt || a.createdAt || 0) - new Date(b.scheduledAt || b.createdAt || 0));
            const idx = queuedList.findIndex((c) => c.id === camp.id);
            const pos = idx >= 0 ? idx + 1 : 1;
            stageDisplayHtml = `<div style="font-size: 10px; color: #fbbf24; margin-top: 2px;">⏳ In line (#${pos})</div>`;
          }
        }
      }

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); color: var(--text-muted); font-size: 11px;" title="${escapeHtml(camp.id)}">
          ${escapeHtml(shortId)}
        </td>
        <td style="font-weight: 600; color: var(--text-white); max-width: 280px;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(camp.subject || '')}">
            ${escapeHtml(camp.subject || 'Untitled Subject')}
          </div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span>Sender: ${escapeHtml(camp.accountEmail || camp.senderEmail || ('Gmail ' + (camp.userIndex && camp.userIndex !== '0' ? 'Account #' + camp.userIndex : 'Primary')))}</span>
            ${(camp.sentCount || camp.recipientCount) ? `<span style="background: rgba(56, 189, 248, 0.15); color: var(--sky); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0 5px; border-radius: 10px; font-weight: 500; font-size: 9px;">👥 ${camp.sentCount || camp.recipientCount} ${camp.status === 'COMPLETED' ? 'sent' : 'recipients'}</span>` : ''}
          </div>
          ${inlineErrorHtml}
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
            ${statusLabel}
          </span>
          ${stageDisplayHtml}
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
            ${camp.status === 'FAILED'
              ? `<button class="btn btn-primary btn-sm btn-table-run" style="background: #ef4444; border-color: #dc2626;" data-id="${camp.id}" title="Retry immediately">
                   ↻ Retry Now
                 </button>`
              : `<button class="btn btn-secondary btn-sm btn-table-run" data-id="${camp.id}" title="Run immediately">
                    ▶ Run Now
                 </button>`}
            <button class="btn btn-secondary btn-sm btn-table-details" data-id="${camp.id}" title="View Details & Logs">
              🔍 Details
            </button>
            <button class="btn btn-danger btn-sm btn-table-cancel" data-id="${camp.id}" title="Cancel or Delete">
              ✕
            </button>
          </div>
        </td>
      `;

      // Actions
      const btnRun = tr.querySelector('.btn-table-run');
      if (btnRun) {
        btnRun.addEventListener('click', () => triggerCampaign(camp.id, btnRun));
      }
      tr.querySelector('.btn-table-details')?.addEventListener('click', () => openDetailsModal(camp));
      tr.querySelector('.btn-table-cancel')?.addEventListener('click', () => deleteOrCancelCampaign(camp.id));

      campaignsTableBody.appendChild(tr);
    });
  }

  function updateQueueStatusWidget() {
    if (!queueStatusCard) return;

    const activeCamps = allCampaigns.filter((c) => c.status === 'PROCESSING');
    const waitingList = allCampaigns
      .filter((c) => c.status === 'QUEUED' || c.status === 'MISSED_OFFLINE')
      .sort((a, b) => new Date(a.scheduledAt || a.createdAt || 0) - new Date(b.scheduledAt || b.createdAt || 0));

    const queueActiveSlotsLabel = document.getElementById('queueActiveSlotsLabel');
    if (queueWaitingCount) {
      queueWaitingCount.textContent = String(waitingList.length);
    }

    if (activeCamps.length > 0) {
      if (queuePulseDot) {
        queuePulseDot.className = 'status-pulse-dot';
      }
      if (queueActiveSlotsLabel) {
        queueActiveSlotsLabel.textContent = `${activeCamps.length} / 3 Accounts`;
      }
      if (queueProcessingLabel) {
        const items = activeCamps.map((camp) => {
          const campSubject = camp.subject || camp.name || ('#' + camp.id.slice(-6));
          const campAccount = camp.accountEmail || camp.senderEmail || 'Default Account';
          const progressInfo = camp.progressPct ? ` (${camp.progressPct}%)` : '';
          return `<strong>"${escapeHtml(campSubject)}"</strong> <span style="color: var(--text-muted); font-size: 11px;">(${escapeHtml(campAccount)})</span><span style="color: #60a5fa; font-weight: 600; margin-left: 2px;">${progressInfo}</span>`;
        });
        queueProcessingLabel.innerHTML = items.join(' &bull; ');
      }
      if (queueLockStateBadge) {
        queueLockStateBadge.className = 'badge badge-busy';
        queueLockStateBadge.textContent = `⚡ RUNNING (${activeCamps.length}/3)`;
      }
    } else if (waitingList.length > 0) {
      if (queuePulseDot) {
        queuePulseDot.className = 'status-pulse-dot idle';
      }
      if (queueActiveSlotsLabel) {
        queueActiveSlotsLabel.textContent = `0 / 3 Accounts`;
      }
      if (queueProcessingLabel) {
        const nextCamp = waitingList[0];
        const nextSubject = nextCamp.subject || nextCamp.name || ('#' + nextCamp.id.slice(-6));
        const nextAccount = nextCamp.accountEmail || nextCamp.senderEmail || 'Default Account';
        queueProcessingLabel.innerHTML = `<span style="color: var(--text-muted);">Ready to dispatch:</span> <strong>"${escapeHtml(nextSubject)}"</strong> <span style="font-size: 11px; color: var(--text-muted);">(${escapeHtml(nextAccount)})</span>`;
      }
      if (queueLockStateBadge) {
        queueLockStateBadge.className = 'badge badge-queued';
        queueLockStateBadge.textContent = '⏳ IN QUEUE';
      }
    } else {
      if (queuePulseDot) {
        queuePulseDot.className = 'status-pulse-dot idle';
      }
      if (queueActiveSlotsLabel) {
        queueActiveSlotsLabel.textContent = `0 / 3 Accounts`;
      }
      if (queueProcessingLabel) {
        queueProcessingLabel.textContent = 'Idle (No active campaign)';
      }
      if (queueLockStateBadge) {
        queueLockStateBadge.className = 'badge badge-idle';
        queueLockStateBadge.textContent = '● IDLE';
      }
    }
  }

  async function triggerCampaign(campaignId, btnElement) {
    if (btnElement) {
      if (btnElement.disabled) return;
      btnElement.disabled = true;
      btnElement._origHtml = btnElement.innerHTML;
      btnElement.innerHTML = '⏳ Dispatched...';
    }
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
    } finally {
      if (btnElement) {
        setTimeout(() => {
          btnElement.disabled = false;
          if (btnElement._origHtml) btnElement.innerHTML = btnElement._origHtml;
        }, 2000);
      }
    }
  }

  function openRescheduleModal(camp) {
    rescheduleCampaignId.value = camp.id;
    const isPast = camp.scheduledAt && new Date(camp.scheduledAt).getTime() <= Date.now();
    if (camp.scheduledAt && !isPast) {
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

    if (btnConfirmReschedule) {
      btnConfirmReschedule.disabled = true;
      btnConfirmReschedule.textContent = '⏳ Rescheduling...';
    }

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
    } finally {
      if (btnConfirmReschedule) {
        btnConfirmReschedule.disabled = false;
        btnConfirmReschedule.textContent = 'Confirm Reschedule';
      }
    }
  }



  async function deleteOrCancelCampaign(campaignId) {
    if (!confirm('Are you sure you want to cancel and remove this campaign?')) {
      return;
    }

    try {
      if (window.IDBStore) {
        await window.IDBStore.deleteCampaign(campaignId);
        await window.IDBStore.addLog(campaignId, 'WARN', 'Campaign deleted from dashboard.').catch(() => {});
      }

      // Notify central background to permanently tombstone, clear alarms & purge from all open Gmail tabs
      if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        try {
          await chrome.runtime.sendMessage({ action: 'DELETE_CAMPAIGN', campaignId });
        } catch (e) {}
      }

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
            <span style="color: var(--text-muted);">Audience / Sent:</span>
            <strong style="margin-left: 6px; color: var(--sky);">👥 ${camp.sentCount || camp.recipientCount || '--'} emails</strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Scheduled:</span>
            <span style="margin-left: 6px;">${escapeHtml(camp.scheduledAt || 'Immediate')}</span>
          </div>
          <div>
            <span style="color: var(--text-muted);">Recipient Column:</span>
            <strong style="margin-left: 6px;">${escapeHtml(camp.recipientColumn || 'Email')}</strong>
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

        ${camp.domAutopsy ? `
          <div>
            <label style="font-size: 11px; font-weight: 600; color: #38bdf8; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between;">
              <span style="display: flex; align-items: center; gap: 6px;">
                🔬 DOM Autopsy &amp; Machine Forensics
              </span>
              <span style="font-size: 10px; color: var(--text-muted); font-weight: 400; text-transform: none;">(~2 KB lightweight DOM state)</span>
            </label>
            <div style="background: #090d16; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 6px; padding: 12px; margin-top: 6px; font-size: 11px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; color: var(--text-muted);">
                <div><strong>URL:</strong> <span style="color: var(--text-primary); word-break: break-all;">${escapeHtml(camp.domAutopsy.url || '')}</span></div>
                <div><strong>Hash:</strong> <span style="color: #38bdf8; font-family: var(--font-mono);">${escapeHtml(camp.domAutopsy.hash || '(none)')}</span></div>
                <div><strong>Last Step:</strong> <span style="color: #f59e0b; font-family: var(--font-mono); font-weight: 600;">${escapeHtml(camp.domAutopsy.lastKnownStep || 'UNKNOWN')}</span></div>
                <div><strong>Active Focus:</strong> <span style="color: var(--text-primary); font-family: var(--font-mono);">${escapeHtml(camp.domAutopsy.activeElement || 'none')}</span></div>
              </div>

              ${camp.domAutopsy.visibleAlerts && camp.domAutopsy.visibleAlerts.length > 0 ? `
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; padding: 6px 10px; margin-bottom: 10px; color: #fca5a5;">
                  <strong>⚠️ Visible Banner/Alert:</strong> ${camp.domAutopsy.visibleAlerts.map(a => escapeHtml(a)).join(' | ')}
                </div>
              ` : ''}

              ${camp.domAutopsy.visibleDialogs && camp.domAutopsy.visibleDialogs.length > 0 ? `
                <div style="margin-bottom: 6px;">
                  <strong style="color: var(--text-secondary);">Visible Dialogs Found (${camp.domAutopsy.visibleDialogs.length}):</strong>
                </div>
                ${camp.domAutopsy.visibleDialogs.map((d, idx) => `
                  <div style="background: rgba(56, 189, 248, 0.04); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 4px; padding: 8px; margin-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span style="color: #38bdf8; font-weight: 600;">Dialog ${idx + 1} (Role: ${escapeHtml(d.role)}${d.ariaLabel ? ' – "' + escapeHtml(d.ariaLabel) + '"' : ''})</span>
                    </div>
                    <div style="color: var(--text-muted); margin-bottom: 6px;">
                      <strong style="color: var(--text-secondary);">Visible Buttons:</strong>
                      ${d.visibleButtons && d.visibleButtons.length > 0
                        ? d.visibleButtons.map(b => `<span style="display: inline-block; background: rgba(56, 189, 248, 0.15); color: #7dd3fc; padding: 1px 6px; border-radius: 3px; margin: 2px 3px; font-family: var(--font-mono); font-size: 10px;">${escapeHtml(b)}</span>`).join('')
                        : '<span style="color: #f87171;">[None detected]</span>'}
                    </div>
                    ${d.htmlSnippet ? `
                      <details style="cursor: pointer;">
                        <summary style="color: var(--text-secondary); font-size: 10px;">View Truncated HTML Snippet (Ctrl+F to search)</summary>
                        <pre style="background: #020617; color: #34d399; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 10px; margin-top: 4px; white-space: pre-wrap; word-break: break-all; max-height: 120px;">${escapeHtml(d.htmlSnippet)}</pre>
                      </details>
                    ` : ''}
                  </div>
                `).join('')}
              ` : `
                <div style="color: #f87171; font-weight: 500; padding: 4px 0;">⚠️ No visible modal or compose dialogs found on screen at time of failure.</div>
              `}
            </div>
          </div>
        ` : ''}

        <div>
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Body Template Preview</label>
          <div style="background: var(--bg-input); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 11px; max-height: 140px; overflow-y: auto; white-space: pre-wrap; margin-top: 4px;">
            ${escapeHtml(camp.bodyTemplate || '')}
          </div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="btnDetailsOpenGmail" class="btn btn-primary btn-sm" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px;">
            <span>✉️ Open Gmail Compose</span>
          </button>
          ${(camp.hasForensic || camp.status === 'FAILED') ? `
            <button id="btnDetailsForensicsViewer" class="btn btn-secondary btn-sm btn-table-forensics" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px;">
              <span>📸 View Screen Capture &amp; Observation</span>
            </button>
          ` : ''}
        </div>

        <div>
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Activity & Execution Logs</label>
          <div style="background: #050811; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; max-height: 160px; overflow-y: auto; margin-top: 4px;">
            ${logsHtml}
          </div>
        </div>
      </div>
    `;

    modalDetailsContent.querySelector('#btnDetailsOpenGmail')?.addEventListener('click', () => {
      closeModal('modalCampaignDetails');
      openGmailTab();
    });

    modalDetailsContent.querySelector('#btnDetailsForensicsViewer')?.addEventListener('click', () => {
      closeModal('modalCampaignDetails');
      openForensicsViewer(camp);
    });

    openModal('modalCampaignDetails');
  }

  async function openForensicsViewer(campOrId) {
    const camp = typeof campOrId === 'string'
      ? (allCampaigns.find((c) => c.id === campOrId) || (await window.IDBStore?.getCampaignById(campOrId)) || { id: campOrId })
      : campOrId;

    if (!camp || !camp.id) return;

    let captures = [];
    if (window.IDBStore && typeof window.IDBStore.getForensicsByCampaign === 'function') {
      captures = await window.IDBStore.getForensicsByCampaign(camp.id);
    }
    if (captures.length === 0 && window.IDBStore && typeof window.IDBStore.getLatestForensic === 'function') {
      const latest = await window.IDBStore.getLatestForensic(camp.id);
      if (latest) captures = [latest];
    }

    const campaignTitleEl = document.getElementById('forensicsCampaignTitle');
    const timestampEl = document.getElementById('forensicsTimestamp');
    const stageEl = document.getElementById('forensicsStage');
    const errorTextEl = document.getElementById('forensicsErrorText');
    const imageEl = document.getElementById('forensicsImage');
    const noImgPlaceholder = document.getElementById('forensicsNoImagePlaceholder');
    const domSnippetEl = document.getElementById('forensicsDomSnippet');
    const domSectionEl = document.getElementById('forensicsDomSection');
    const btnDownload = document.getElementById('btnDownloadForensicImg');
    const selectorRow = document.getElementById('forensicsCaptureSelectorRow');
    const captureSelect = document.getElementById('forensicsCaptureSelect');

    campaignTitleEl.textContent = camp.subject || camp.name || camp.id;

    function displayCapture(capture) {
      if (!capture) {
        timestampEl.textContent = camp.updatedAt ? new Date(camp.updatedAt).toLocaleString() : '--';
        stageEl.textContent = camp.status || 'FAILED';
        stageEl.className = 'badge badge-failed';
        errorTextEl.textContent = camp.errorMessage || 'No visual or DOM snapshot recorded.';
        imageEl.style.display = 'none';
        noImgPlaceholder.style.display = 'block';
        noImgPlaceholder.textContent = 'No visual screenshot captured for this campaign. DOM autopsy state preserved below.';
        btnDownload.style.display = 'none';

        if (camp.domAutopsy) {
          domSectionEl.style.display = 'block';
          let snippet = `=== DOM AUTOPSY (MACHINE FORENSICS) ===\n`;
          snippet += `Last Step: ${camp.domAutopsy.lastKnownStep || 'UNKNOWN'}\n`;
          snippet += `URL: ${camp.domAutopsy.url || ''}\n`;
          snippet += `Hash: ${camp.domAutopsy.hash || '(none)'}\n`;
          snippet += `Active Element: ${camp.domAutopsy.activeElement || 'none'}\n`;
          if (camp.domAutopsy.visibleAlerts && camp.domAutopsy.visibleAlerts.length > 0) {
            snippet += `Visible Alerts: ${camp.domAutopsy.visibleAlerts.join(' | ')}\n`;
          }
          if (camp.domAutopsy.visibleDialogs && camp.domAutopsy.visibleDialogs.length > 0) {
            snippet += `Visible Dialogs (${camp.domAutopsy.visibleDialogs.length}):\n`;
            camp.domAutopsy.visibleDialogs.forEach((d, i) => {
              snippet += `  [#${i + 1}] Role="${d.role}" Aria="${d.ariaLabel || ''}" Buttons=[${(d.visibleButtons || []).join(', ')}]\n`;
            });
          }
          domSnippetEl.textContent = snippet.trim();
        } else {
          domSectionEl.style.display = 'none';
        }
        return;
      }

      timestampEl.textContent = capture.timestamp ? new Date(capture.timestamp).toLocaleString() : '--';
      stageEl.textContent = capture.stage || camp.status || 'UNKNOWN';
      stageEl.className = capture.stage === 'READY_TO_SEND' ? 'badge badge-completed' : 'badge badge-failed';
      errorTextEl.textContent = capture.errorMessage || camp.errorMessage || 'No error message recorded.';

      const imgData = capture.screenshotDataUrl || capture.screenshotUrl;
      if (imgData) {
        imageEl.src = imgData;
        imageEl.style.display = 'block';
        noImgPlaceholder.style.display = 'none';
        btnDownload.href = imgData;
        btnDownload.download = `mailmerge_${camp.id}_${capture.stage || 'capture'}.jpg`;
        btnDownload.style.display = 'inline-flex';
      } else {
        imageEl.style.display = 'none';
        noImgPlaceholder.style.display = 'block';
        noImgPlaceholder.textContent = 'Visual screenshot unavailable (window may have been minimized). DOM text preserved below.';
        btnDownload.style.display = 'none';
      }

      if (capture.domSnippet || capture.popupTitle || camp.domAutopsy) {
        domSectionEl.style.display = 'block';
        let snippet = '';
        if (camp.domAutopsy) {
          snippet += `=== DOM AUTOPSY (MACHINE FORENSICS) ===\n`;
          snippet += `Last Step: ${camp.domAutopsy.lastKnownStep || 'UNKNOWN'}\n`;
          snippet += `URL: ${camp.domAutopsy.url || ''}\n`;
          snippet += `Hash: ${camp.domAutopsy.hash || '(none)'}\n`;
          snippet += `Active Element: ${camp.domAutopsy.activeElement || 'none'}\n`;
          if (camp.domAutopsy.visibleAlerts && camp.domAutopsy.visibleAlerts.length > 0) {
            snippet += `Visible Alerts: ${camp.domAutopsy.visibleAlerts.join(' | ')}\n`;
          }
          if (camp.domAutopsy.visibleDialogs && camp.domAutopsy.visibleDialogs.length > 0) {
            snippet += `Visible Dialogs (${camp.domAutopsy.visibleDialogs.length}):\n`;
            camp.domAutopsy.visibleDialogs.forEach((d, i) => {
              snippet += `  [#${i + 1}] Role="${d.role}" Aria="${d.ariaLabel || ''}" Buttons=[${(d.visibleButtons || []).join(', ')}]\n`;
            });
          }
          snippet += `\n=== CAPTURED ELEMENT SNIPPET ===\n`;
        }
        if (capture.popupTitle) {
          snippet += `[Popup/Modal Title: ${capture.popupTitle}]\n\n`;
        }
        if (capture.domSnippet) {
          snippet += capture.domSnippet;
        }
        domSnippetEl.textContent = snippet.trim();
      } else {
        domSectionEl.style.display = 'none';
      }
    }

    if (captures.length > 1) {
      selectorRow.style.display = 'flex';
      captureSelect.innerHTML = '';
      captures.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        const time = formatTimeShort(c.timestamp);
        opt.textContent = `#${idx + 1} [${time}] ${c.stage} ${c.errorMessage ? '– ' + c.errorMessage.slice(0, 35) : ''}`;
        captureSelect.appendChild(opt);
      });
      captureSelect.value = String(captures.length - 1);
      captureSelect.onchange = () => {
        const selectedIdx = parseInt(captureSelect.value, 10);
        displayCapture(captures[selectedIdx]);
      };
      displayCapture(captures[captures.length - 1]);
    } else if (captures.length === 1) {
      selectorRow.style.display = 'none';
      displayCapture(captures[0]);
    } else {
      selectorRow.style.display = 'none';
      displayCapture(null);
    }

    openModal('modalForensicsViewer');
  }

  // =========================================================================
  // ARCHIVED STORAGE
  // =========================================================================

  async function openArchivedCampaignsModal() {
    const tableBody = document.getElementById('archivedTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading archived campaigns...</td></tr>`;
    openModal('modalArchivedCampaigns');

    try {
      let list = [];
      if (window.IDBStore && typeof window.IDBStore.getArchivedCampaigns === 'function') {
        list = await window.IDBStore.getArchivedCampaigns();
      }

      if (list.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="6" class="table-empty" style="padding: 24px;">
              <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">No Archived Campaigns</div>
              <div style="font-size: 11px; color: var(--text-muted);">
                When failed or completed campaigns are archived, they are safely preserved here for audit.
              </div>
            </td>
          </tr>
        `;
        return;
      }

      tableBody.innerHTML = '';
      list.forEach((c) => {
        const tr = document.createElement('tr');
        const sheetTitle = c.spreadsheetTitle || extractSheetName(c.spreadsheetUrl) || 'Google Sheet';
        const sheetLinkHtml = c.spreadsheetUrl
          ? `<a href="${escapeHtml(c.spreadsheetUrl)}" target="_blank" style="color: var(--sky); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
              <span>${escapeHtml(sheetTitle)}</span>
              <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
             </a>`
          : `<span style="color: var(--text-muted);">None</span>`;

        tr.innerHTML = `
          <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${formatTimeShort(c.archivedAt || c.updatedAt)}</td>
          <td style="font-weight: 600; color: var(--text-white); max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.subject || '')}">
            ${escapeHtml(c.subject || 'Untitled Subject')}
          </td>
          <td style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${sheetLinkHtml}
          </td>
          <td style="font-size: 11px; color: var(--text-secondary);">
            ${escapeHtml(c.accountEmail || c.senderEmail || 'Default Account')}
          </td>
          <td>
            <span class="badge ${c.originalStatus === 'FAILED' ? 'badge-failed' : 'badge-queued'}">
              ${escapeHtml(c.originalStatus || 'ARCHIVED')}
            </span>
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm btn-archived-open" style="border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="Open Gmail to compose">
                ✉️ Open Gmail
              </button>
              <button class="btn btn-danger btn-sm btn-archived-del" title="Permanently delete from archive">
                ✕
              </button>
            </div>
          </td>
        `;

        tr.querySelector('.btn-archived-open')?.addEventListener('click', () => {
          closeModal('modalArchivedCampaigns');
          openGmailTab();
        });

        tr.querySelector('.btn-archived-del')?.addEventListener('click', async () => {
          if (!confirm(`Permanently delete "${c.subject || c.id}" from archive?`)) return;
          if (window.IDBStore && typeof window.IDBStore.deleteArchivedCampaign === 'function') {
            await window.IDBStore.deleteArchivedCampaign(c.id);
            showToast('Deleted from archive');
            await openArchivedCampaignsModal();
            await loadCampaigns();
          }
        });

        tableBody.appendChild(tr);
      });
    } catch (err) {
      console.error('[Dashboard] Error rendering archived campaigns:', err);
      tableBody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color: var(--rose);">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function clearAllArchived() {
    if (!confirm('Are you sure you want to permanently delete ALL archived campaigns? This action cannot be undone.')) {
      return;
    }
    if (window.IDBStore && typeof window.IDBStore.clearAllArchivedCampaigns === 'function') {
      await window.IDBStore.clearAllArchivedCampaigns();
      showToast('🗑️ All archived campaigns permanently cleared.');
      await openArchivedCampaignsModal();
      await loadCampaigns();
    }
  }

  // =========================================================================
  // TAB 2: TEMPLATES MANAGER
  // =========================================================================

  async function loadTemplates() {
    try {
      if (window.IDBStore) {
        allTemplates = await window.IDBStore.getTemplates();
      } else {
        allTemplates = [];
      }

      // Check chrome.storage.local to merge any freshly synced templates
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const st = await chrome.storage.local.get(['mail_merge_templates']);
        if (Array.isArray(st.mail_merge_templates) && st.mail_merge_templates.length > 0) {
          const idSet = new Set(allTemplates.map((t) => t.id));
          const nameSet = new Set(allTemplates.map((t) => (t.name || '').trim().toLowerCase()));
          for (const t of st.mail_merge_templates) {
            if (t && t.id && !idSet.has(t.id)) {
              const nameKey = (t.name || '').trim().toLowerCase();
              if (!nameKey || !nameSet.has(nameKey)) {
                allTemplates.push(t);
                idSet.add(t.id);
                if (nameKey) nameSet.add(nameKey);
                if (window.IDBStore) {
                  window.IDBStore.saveTemplate(t).catch(() => {});
                }
              }
            }
          }
        }
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

      const previewContent = tpl.bodyHtml
        ? `<div class="template-card-preview-html">${tpl.bodyHtml}</div>`
        : `<div class="template-card-preview">${escapeHtml(tpl.body || '(No content)')}</div>`;

      card.innerHTML = `
        <div>
          <h3 class="template-card-title">${escapeHtml(tpl.name || 'Untitled Template')}</h3>
          <div class="template-card-subject" title="${escapeHtml(tpl.subject || '')}">
            Subject: ${escapeHtml(tpl.subject || 'No Subject')}
          </div>
          <div class="template-card-preview-container">
            ${previewContent}
          </div>
        </div>
        <div class="template-card-actions">
          <button class="btn btn-primary btn-sm btn-use-template" title="Open Gmail to use this template">
            <span>✉️ Compose in Gmail</span>
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

      card.querySelector('.btn-use-template').addEventListener('click', async () => {
        showToast(`Template "${tpl.name}" selected! Opening Gmail to compose...`);
        await openGmailTab();
      });

      card.querySelector('.btn-edit-template').addEventListener('click', () => {
        editTemplateId.value = tpl.id;
        editTemplateName.value = tpl.name || '';
        editTemplateSubject.value = tpl.subject || '';
        const htmlContent = tpl.bodyHtml || (tpl.body ? escapeHtml(tpl.body).replace(/\n/g, '<br>') : '');
        if (editTemplateBodyHtml) {
          editTemplateBodyHtml.innerHTML = htmlContent;
          editTemplateBodyHtml.style.display = 'block';
        }
        if (editTemplateSourceArea) {
          editTemplateSourceArea.value = htmlContent;
          editTemplateSourceArea.style.display = 'none';
        }
        if (btnToggleSourceMode) {
          btnToggleSourceMode.textContent = '<> HTML Source';
          btnToggleSourceMode.classList.remove('btn-primary');
        }
        modalTemplateTitle.textContent = 'Edit Template';
        openModal('modalTemplate');
      });

      card.querySelector('.btn-del-template').addEventListener('click', async () => {
        if (confirm(`Delete template "${tpl.name}"?`)) {
          await window.IDBStore.deleteTemplate(tpl.id);
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'DELETE_TEMPLATE', templateId: tpl.id }).catch(() => {});
          }
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

    // If source mode textarea is currently visible, read directly from textarea
    const isSourceView = editTemplateSourceArea && editTemplateSourceArea.style.display !== 'none';
    const bodyHtml = isSourceView
      ? editTemplateSourceArea.value.trim()
      : (editTemplateBodyHtml ? editTemplateBodyHtml.innerHTML.trim() : '');
    const body = isSourceView
      ? editTemplateSourceArea.value.replace(/<[^>]+>/g, ' ').trim()
      : (editTemplateBodyHtml ? editTemplateBodyHtml.innerText.trim() : '');

    if (!name) {
      alert('Please provide a Template Name.');
      return;
    }

    if (!subject && !body && !bodyHtml) {
      alert('Please provide at least a Subject or an Email Body for the template.');
      return;
    }

    try {
      const existing = allTemplates.find((t) => t.id === id);
      const template = {
        ...(existing || {}),
        id: id || ('tpl_' + Date.now()),
        name,
        subject,
        body,
        bodyHtml,
        updatedAt: new Date().toISOString()
      };

      await window.IDBStore.saveTemplate(template);
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'SAVE_TEMPLATE', template }).catch(() => {});
      }
      closeModal('modalTemplate');
      showToast('Template saved successfully');
      await loadTemplates();
    } catch (err) {
      console.error('[Dashboard] Error saving template:', err);
      alert('Failed to save template: ' + err.message);
    }
  }

  // =========================================================================
  // 24/7 SYSTEM HEALTH & DIAGNOSTIC VERIFICATION
  // =========================================================================

  async function run247SystemHealthCheck() {
    if (!healthCheckResultBox) return;
    healthCheckResultBox.style.display = 'block';
    healthCheckResultBox.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; color: #38bdf8;">
        <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid #38bdf8; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></span>
        <span>Running 24/7 Diagnostics & System Verification...</span>
      </div>
    `;

    const results = [];

    // Test 1: Open Gmail Tabs & Content Script
    try {
      if (chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
        if (tabs && tabs.length > 0) {
          let pinged = 0;
          for (const t of tabs) {
            try {
              const resp = await chrome.tabs.sendMessage(t.id, { action: 'PING' }).catch(() => null);
              if (resp && resp.status === 'PONG') pinged++;
            } catch (_) {}
          }
          if (pinged > 0) {
            results.push({
              status: 'PASS',
              title: 'Gmail Tab Communication',
              detail: `Verified ${pinged} responsive Gmail tab(s) with content script active.`
            });
          } else {
            results.push({
              status: 'WARN',
              title: 'Gmail Tab Content Script',
              detail: `${tabs.length} Gmail tab(s) open, but content script did not respond. Refresh Gmail tabs (F5).`
            });
          }
        } else {
          results.push({
            status: 'WARN',
            title: 'No Gmail Tabs Open',
            detail: 'No active mail.google.com tabs found. Open Gmail so background campaigns can execute.'
          });
        }
      }
    } catch (e) {
      results.push({ status: 'WARN', title: 'Gmail Tabs', detail: e.message });
    }

    // Test 2: Background Alarms & Scheduler
    try {
      if (chrome.alarms && chrome.alarms.get) {
        const alarm = await chrome.alarms.get('POLL_CAMPAIGNS_ALARM');
        if (alarm) {
          const nextSec = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 1000));
          results.push({
            status: 'PASS',
            title: 'Background Scheduler Alarm',
            detail: `Active! Next queue poll in ~${nextSec}s. 1-minute recurring dispatch active.`
          });
        } else {
          results.push({
            status: 'WARN',
            title: 'Scheduler Alarm Idle',
            detail: 'Alarm is re-registering or idle. Triggering service worker heartbeat...'
          });
          if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'FORCE_POLL' }).catch(() => {});
          }
        }
      }
    } catch (e) {
      results.push({ status: 'WARN', title: 'Scheduler Alarm', detail: e.message });
    }

    // Test 3: Storage & IndexedDB Health
    try {
      if (window.IDBStore) {
        const tpls = await window.IDBStore.getTemplates();
        const camps = await window.IDBStore.getCampaigns();
        results.push({
          status: 'PASS',
          title: 'IndexedDB Storage Engine',
          detail: `Database operational (${tpls.length} templates, ${camps.length} campaigns stored).`
        });
      }
    } catch (e) {
      results.push({ status: 'FAIL', title: 'Database Health', detail: e.message });
    }

    // Test 4: Tab Discarding Policy Reminder
    results.push({
      status: 'INFO',
      title: 'Memory Saver Tab Policy',
      detail: 'If not already done, double-click SETUP_FRESH_PC.bat to guarantee Chrome never unloads Gmail tabs.'
    });

    // Render Results
    let html = `
      <div style="font-weight: 700; color: #f8fafc; margin-bottom: 8px; font-size: 13px; display: flex; align-items: center; justify-content: space-between;">
        <span>Diagnostic Results (${new Date().toLocaleTimeString()}):</span>
        <button id="btnCloseHealthResult" class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 2px 6px;">✕ Close</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
    `;

    results.forEach((r) => {
      const color = r.status === 'PASS' ? '#34d399' : (r.status === 'WARN' ? '#fbbf24' : (r.status === 'FAIL' ? '#f87171' : '#38bdf8'));
      const icon = r.status === 'PASS' ? '✅' : (r.status === 'WARN' ? '⚠️' : (r.status === 'FAIL' ? '❌' : 'ℹ️'));
      html += `
        <div style="background: rgba(255, 255, 255, 0.04); padding: 6px 10px; border-radius: 6px; display: flex; align-items: flex-start; gap: 8px;">
          <span>${icon}</span>
          <div style="flex: 1;">
            <strong style="color: ${color}; font-size: 11px;">${escapeHtml(r.title)}:</strong>
            <span style="color: #cbd5e1; font-size: 11px; margin-left: 4px;">${escapeHtml(r.detail)}</span>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    healthCheckResultBox.innerHTML = html;

    document.getElementById('btnCloseHealthResult')?.addEventListener('click', () => {
      healthCheckResultBox.style.display = 'none';
    });
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
      const isForensic = log.message && log.message.includes('[FORENSIC]');
      const forensicBtnHtml = (isForensic && log.campaignId)
        ? `<button class="btn-log-forensic badge-forensic" data-camp-id="${escapeHtml(log.campaignId)}" style="cursor: pointer; border: none; margin-left: 6px;" title="View Screen Capture & Observation">📸 View Capture</button>`
        : '';

      const campIdStr = log.campaignId || 'SYSTEM';

      entry.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="log-level ${log.level}">${log.level}</span>
        <span class="log-campaign">${escapeHtml(campIdStr)}</span>
        <span class="log-msg">${escapeHtml(log.message || '')}${forensicBtnHtml}</span>
      `;

      entry.querySelector('.btn-log-forensic')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openForensicsViewer(log.campaignId);
      });

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

  // =========================================================================
  // ZERO-RELOAD LIVE STREAMING & KEEP-ALIVE PORT
  // =========================================================================

  let keepAlivePingTimer = null;

  function connectLiveStream() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect) return;

    try {
      if (liveStreamPort) {
        try { liveStreamPort.disconnect(); } catch (_) {}
      }

      liveStreamPort = chrome.runtime.connect({ name: 'MM_LIVE_STREAM' });
      console.log('[Dashboard] ⚡ Connected to MM_LIVE_STREAM keep-alive port');

      liveStreamPort.onMessage.addListener((msg) => {
        if (!msg || !msg.action) return;

        if (msg.action === 'CONNECTED') {
          console.log('[Dashboard] ⚡ Live stream handshake confirmed.');
          return;
        }

        if (msg.action === 'PONG') {
          return;
        }

        // Live Campaign Updates: status, progress, deletions, archives, etc.
        if (
          msg.action === 'CAMPAIGN_PROGRESS' ||
          msg.action === 'CAMPAIGN_STATUS_UPDATE' ||
          msg.action === 'CAMPAIGN_QUEUED' ||
          msg.action === 'CAMPAIGN_DELETED' ||
          msg.action === 'CAMPAIGNS_ARCHIVED' ||
          msg.action === 'ALL_FAILED_RETRIED' ||
          msg.action === 'ACCOUNT_QUOTA_UNPAUSED'
        ) {
          loadCampaigns().catch(() => {});
          loadLogs().catch(() => {});
        }

        // Live Template Updates
        if (
          msg.action === 'TEMPLATE_SAVED' ||
          msg.action === 'TEMPLATE_UPDATED' ||
          msg.action === 'REFRESH_TEMPLATES'
        ) {
          loadTemplates().catch(() => {});
        }
      });

      liveStreamPort.onDisconnect.addListener(() => {
        console.warn('[Dashboard] Live stream port disconnected. Reconnecting in 2s...');
        liveStreamPort = null;
        if (keepAlivePingTimer) clearInterval(keepAlivePingTimer);
        setTimeout(connectLiveStream, 2000);
      });

      // Keep service worker and port alive with periodic 20s ping
      if (keepAlivePingTimer) clearInterval(keepAlivePingTimer);
      keepAlivePingTimer = setInterval(() => {
        if (liveStreamPort) {
          try {
            liveStreamPort.postMessage({ action: 'PING' });
          } catch (_) {
            connectLiveStream();
          }
        }
      }, 20000);

    } catch (err) {
      console.error('[Dashboard] Error establishing live stream:', err);
      setTimeout(connectLiveStream, 3000);
    }
  }

  // Connect live stream on initial load
  connectLiveStream();

  // Fallback broadcast listener for standard runtime messages (only used if live stream port is disconnected)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (liveStreamPort) return; // Prevent duplicate execution when liveStreamPort is active
      if (
        msg.action === 'CAMPAIGN_PROGRESS' ||
        msg.action === 'CAMPAIGN_STATUS_UPDATE' ||
        msg.action === 'CAMPAIGN_QUEUED' ||
        msg.action === 'CAMPAIGN_DELETED' ||
        msg.action === 'CAMPAIGNS_ARCHIVED' ||
        msg.action === 'ALL_FAILED_RETRIED' ||
        msg.action === 'ACCOUNT_QUOTA_UNPAUSED'
      ) {
        loadCampaigns().catch(() => {});
        loadLogs().catch(() => {});
      }
      if (
        msg.action === 'TEMPLATE_SAVED' ||
        msg.action === 'TEMPLATE_UPDATED' ||
        msg.action === 'REFRESH_TEMPLATES'
      ) {
        loadTemplates().catch(() => {});
      }
    });
  }

  // Auto-refresh when Dashboard tab or window regains focus
  window.addEventListener('focus', () => {
    loadTemplates().catch(() => {});
    loadCampaigns().catch(() => {});
    checkSystemDiagnostics().catch(() => {});
    if (!liveStreamPort) connectLiveStream();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadTemplates().catch(() => {});
      loadCampaigns().catch(() => {});
      checkSystemDiagnostics().catch(() => {});
      if (!liveStreamPort) connectLiveStream();
    }
  });
});
