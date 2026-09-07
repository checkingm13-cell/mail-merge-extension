/**
 * Content Script for Gmail Native Mail Merge & Scheduler
 * Architecture: Zero Extra UI (read-from-this.txt Master Protocol)
 *
 * 1. Native Compose is 100% untouched and clean. No side panels, no big compose widgets.
 * 2. Injects "📅 Schedule" inline button next to Gmail's purple "Continue" button.
 * 3. Injects "📅 Schedule for later" button directly inside the "Ready to send" modal.
 * 4. When scheduled: saves campaign state, sets background alarm, and cleanly closes compose window.
 * 5. At scheduled time: executes native multi-send dispatch via GmailAutomator.
 */
(function (root) {
  'use strict';

  if (root.__GMAIL_MAIL_MERGE_CONTENT_INITIALIZED__) {
    console.log('[MailMerge ContentScript] Already initialized in this tab.');
    return;
  }
  root.__GMAIL_MAIL_MERGE_CONTENT_INITIALIZED__ = true;

  console.log('[MailMerge ContentScript] Master Protocol Initialized: Zero-UI Native Scheduling active.');

  const MODAL_BTN_CLASS = 'mm-schedule-modal-btn';
  const INLINE_BTN_CLASS = 'mm-schedule-inline';
  const SAVE_TPL_BTN_CLASS = 'mm-save-tpl-inline';
  const LOAD_TPL_BTN_CLASS = 'mm-load-tpl-inline';

  // =========================================================================
  // DOM OBSERVERS (Modal & Compose Buttons & Spam Policy Guard)
  // =========================================================================

  // Observer 1: Watch for Gmail's native "Ready to send" modal
  const modalObserver = new MutationObserver(() => {
    checkAndInjectModal();
    checkAndDismissSpamDisclaimer();
  });
  modalObserver.observe(document.body, { childList: true, subtree: true });

  // Observer 2: Watch for Gmail's native compose dialogs and action buttons
  const composeObserver = new MutationObserver(() => {
    checkAndInjectComposeButtons();
    checkAndDismissSpamDisclaimer();
  });
  composeObserver.observe(document.body, { childList: true, subtree: true });

  // Track active user typing in compose windows to detect when a draft is actively being edited by human
  let lastUserTypingTime = 0;
  let lastActiveDraftId = null;

  document.addEventListener('input', (e) => {
    const compose = e.target?.closest?.('div[role="dialog"], div.M9, div.AD');
    if (compose) {
      lastUserTypingTime = Date.now();
      lastActiveDraftId = getDraftId(compose);
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    const compose = e.target?.closest?.('div[role="dialog"], div.M9, div.AD');
    if (compose) {
      lastUserTypingTime = Date.now();
      lastActiveDraftId = getDraftId(compose);
    }
  }, true);

  // Initial immediate checks
  checkAndInjectModal();
  checkAndInjectComposeButtons();
  checkAndDismissSpamDisclaimer();
  checkAndShowMissedOfflineBanners();

  // Periodic safety scan (ensures dynamic single-page Gmail view changes never miss buttons or warnings)
  setInterval(() => {
    checkAndInjectModal();
    checkAndInjectComposeButtons();
    checkAndDismissSpamDisclaimer();
    checkAndShowMissedOfflineBanners();
  }, 2000);

  /**
   * Auto-detects and dismisses Google's bulk sender / spam policy warning dialog if it appears.
   * Checks "Don't show this again" and clicks "Got it" or "Continue".
   */
  function checkAndDismissSpamDisclaimer() {
    try {
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      for (const dialog of dialogs) {
        const text = (dialog.textContent || '').toLowerCase();
        const isSpamNotice = (
          text.includes('spam') || 
          text.includes('junk') || 
          text.includes('bulk email') || 
          text.includes('bulk sender') || 
          text.includes('best practices')
        ) && (
          text.includes("don't show") || 
          text.includes("dont show") || 
          text.includes("do not show") ||
          text.includes("got it") ||
          text.includes("learn more")
        );

        if (isSpamNotice) {
          console.log('[MailMerge ContentScript] 🛡️ Auto-handling Google bulk sender / spam disclaimer...');
          const checkbox = dialog.querySelector('input[type="checkbox"], div[role="checkbox"]');
          if (checkbox) {
            const isChecked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
            if (!isChecked) {
              checkbox.click();
            }
          }
          const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
          const confirmBtn = buttons.find((b) => {
            const btnText = (b.textContent || '').trim().toLowerCase();
            return /^(got it|continue|ok|i understand|proceed|acknowledge|agree)$/i.test(btnText);
          }) || buttons.find((b) => /got it|continue|ok/i.test((b.textContent || '').trim()));

          if (confirmBtn) {
            confirmBtn.click();
            console.log('[MailMerge ContentScript] ✅ Google spam disclaimer auto-dismissed with "Don\'t show again".');
          }
        }
      }
    } catch (_) {}
  }

  // =========================================================================
  // MISSED-WHILE-OFFLINE NOTIFICATION & IN-TAB BANNER
  // =========================================================================

  // Set to track dismissed banners during current tab session
  const dismissedBannerCampaignIds = new Set();

  /**
   * Periodically checks for any campaigns flagged as MISSED_OFFLINE and displays in-tab warning banners.
   */
  async function checkAndShowMissedOfflineBanners() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
      const resp = await chrome.runtime.sendMessage({ action: 'GET_MISSED_CAMPAIGNS' }).catch(() => null);
      if (resp && resp.success && Array.isArray(resp.campaigns)) {
        for (const camp of resp.campaigns) {
          if (!dismissedBannerCampaignIds.has(camp.id)) {
            showMissedOfflineBanner(camp);
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Displays an interactive floating banner at the top of Gmail for a campaign missed while offline.
   * Gives the user options to "Send Now", "Reschedule", or "Dismiss".
   * @param {Object} camp
   */
  function showMissedOfflineBanner(camp) {
    if (!camp || !camp.id || dismissedBannerCampaignIds.has(camp.id)) return;

    const bannerId = `mm-missed-banner-${camp.id}`;
    if (document.getElementById(bannerId)) return;

    let container = document.getElementById('mm-missed-banners-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mm-missed-banners-container';
      container.style.cssText = [
        'position: fixed',
        'top: 16px',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 1000000',
        'display: flex',
        'flex-direction: column',
        'gap: 10px',
        'width: 90%',
        'max-width: 640px',
        'pointer-events: auto',
        'font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ].join('; ');
      document.body.appendChild(container);
    }

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = [
      'background: #1e293b',
      'color: #f8fafc',
      'border: 1px solid #f59e0b',
      'border-left: 6px solid #f59e0b',
      'border-radius: 8px',
      'box-shadow: 0 10px 25px rgba(0, 0, 0, 0.45)',
      'padding: 12px 18px',
      'display: flex',
      'flex-direction: column',
      'gap: 10px',
      'transition: all 0.25s ease'
    ].join('; ');

    const schedDate = camp.scheduledAt ? new Date(camp.scheduledAt) : new Date();
    const schedStr = schedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' +
      schedDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

    function renderDefaultView() {
      banner.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <span style="font-size: 20px; line-height: 1;">⚠️</span>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f59e0b; display: flex; align-items: center; gap: 6px;">
                <span>Mail Merge Missed While PC Was Offline</span>
                <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-radius: 4px; padding: 1px 6px; font-size: 10px; text-transform: uppercase;">Awaiting Confirmation</span>
              </div>
              <div style="font-size: 13px; font-weight: 600; color: #ffffff; margin-top: 3px; max-width: 440px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                "${escapeHtml(camp.subject || 'Untitled Subject')}"
              </div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Scheduled for: <b style="color: #cbd5e1;">${schedStr}</b>
                ${camp.recipientCount ? ` &bull; 👥 ${camp.recipientCount} recipients` : ''}
              </div>
            </div>
          </div>
          <button class="mm-banner-dismiss-btn" title="Dismiss" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px;">✕</button>
        </div>
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 8px;">
          <button class="mm-banner-dismiss-link" style="background: transparent; border: 1px solid #475569; color: #94a3b8; border-radius: 5px; padding: 5px 12px; font-size: 12px; font-weight: 500; cursor: pointer;">
            Dismiss
          </button>
          <button class="mm-banner-resched-btn" style="background: #4f46e5; border: 1px solid #6366f1; color: #ffffff; border-radius: 5px; padding: 5px 14px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
            <span>⏰</span> Reschedule
          </button>
          <button class="mm-banner-send-btn" style="background: #059669; border: 1px solid #10b981; color: #ffffff; border-radius: 5px; padding: 5px 16px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
            <span>▶</span> Send Now
          </button>
        </div>
      `;

      // Event Listeners
      const handleDismiss = () => {
        dismissedBannerCampaignIds.add(camp.id);
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-10px)';
        setTimeout(() => banner.remove(), 250);
        chrome.runtime.sendMessage({ action: 'DISMISS_MISSED_CAMPAIGN', campaignId: camp.id }).catch(() => {});
      };

      banner.querySelector('.mm-banner-dismiss-btn').addEventListener('click', handleDismiss);
      banner.querySelector('.mm-banner-dismiss-link').addEventListener('click', handleDismiss);

      // Send Now Action
      banner.querySelector('.mm-banner-send-btn').addEventListener('click', () => {
        banner.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px; padding: 6px 0;">
            <span style="font-size: 18px;">⏳</span>
            <span style="font-size: 13px; font-weight: 600; color: #38bdf8;">Dispatching "${escapeHtml(camp.subject || 'Campaign')}" immediately...</span>
          </div>
        `;
        chrome.runtime.sendMessage({
          action: 'TRIGGER_CAMPAIGN_NOW',
          campaignId: camp.id
        }).then((res) => {
          if (res && res.success) {
            banner.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; color: #34d399; font-weight: 600; padding: 6px 0;">
                <span>✅</span> Dispatched! Mail merge automation is in progress...
              </div>
            `;
            setTimeout(() => {
              dismissedBannerCampaignIds.add(camp.id);
              banner.remove();
            }, 2500);
          } else {
            banner.innerHTML = `
              <div style="color: #f87171; font-weight: 600; padding: 6px 0;">
                ⚠️ Dispatch error: ${escapeHtml(res?.error || 'Unknown error')}
              </div>
            `;
            setTimeout(() => banner.remove(), 4000);
          }
        }).catch((err) => {
          banner.innerHTML = `<div style="color: #f87171; font-weight: 600; padding: 6px 0;">⚠️ Error: ${escapeHtml(err.message)}</div>`;
          setTimeout(() => banner.remove(), 4000);
        });
      });

      // Reschedule Action (inline picker)
      banner.querySelector('.mm-banner-resched-btn').addEventListener('click', () => {
        const nextTime = new Date(Date.now() + 10 * 60000);
        const nextTimeLocal = new Date(nextTime.getTime() - nextTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        const minTimeLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

        banner.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 13px; font-weight: 600; color: #e2e8f0; display: flex; align-items: center; gap: 6px;">
              <span>⏰</span> Reschedule "${escapeHtml(camp.subject || 'Campaign')}"
            </span>
            <button class="mm-resched-cancel-x" style="background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer;">✕</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <input type="datetime-local" class="mm-resched-input" value="${nextTimeLocal}" min="${minTimeLocal}" style="flex: 1; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 4px; padding: 6px 10px; font-size: 13px; outline: none;" />
            <button class="mm-resched-confirm-btn" style="background: #4f46e5; border: 1px solid #6366f1; color: #ffffff; border-radius: 4px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer;">Confirm</button>
            <button class="mm-resched-back-btn" style="background: #334155; border: 1px solid #475569; color: #cbd5e1; border-radius: 4px; padding: 6px 10px; font-size: 12px; cursor: pointer;">Back</button>
          </div>
        `;

        banner.querySelector('.mm-resched-cancel-x').addEventListener('click', renderDefaultView);
        banner.querySelector('.mm-resched-back-btn').addEventListener('click', renderDefaultView);

        banner.querySelector('.mm-resched-confirm-btn').addEventListener('click', () => {
          const val = banner.querySelector('.mm-resched-input').value;
          if (!val) return;
          const newTimestamp = new Date(val).getTime();

          banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; color: #38bdf8; font-weight: 600; padding: 6px 0;">
              <span>⏳</span> Updating schedule...
            </div>
          `;

          chrome.runtime.sendMessage({
            action: 'RESCHEDULE_CAMPAIGN',
            campaignId: camp.id,
            scheduledTime: newTimestamp
          }).then((res) => {
            if (res && res.success) {
              banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; color: #34d399; font-weight: 600; padding: 6px 0;">
                  <span>✅</span> Rescheduled for ${new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${new Date(val).toLocaleDateString([], { month: 'short', day: 'numeric' })}!
                </div>
              `;
              dismissedBannerCampaignIds.add(camp.id);
              setTimeout(() => banner.remove(), 2500);
            } else {
              banner.innerHTML = `<div style="color: #f87171; padding: 6px 0;">Failed to reschedule: ${escapeHtml(res?.error || '')}</div>`;
              setTimeout(renderDefaultView, 3000);
            }
          }).catch((err) => {
            banner.innerHTML = `<div style="color: #f87171; padding: 6px 0;">Error: ${escapeHtml(err.message)}</div>`;
            setTimeout(renderDefaultView, 3000);
          });
        });
      });
    }

    renderDefaultView();
    container.appendChild(banner);
  }

  // Synchronize any campaigns created in Gmail's local origin up to the central extension store
  async function syncCampaignsToBackground() {
    try {
      if (!root.IDBStore || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
      const localCampaigns = await root.IDBStore.getCampaigns();
      if (Array.isArray(localCampaigns) && localCampaigns.length > 0) {
        chrome.runtime.sendMessage({
          action: 'SYNC_CAMPAIGNS',
          campaigns: localCampaigns
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Run immediately and periodically
  syncCampaignsToBackground();
  setInterval(syncCampaignsToBackground, 10000);

  // =========================================================================
  // INJECTION LOGIC
  // =========================================================================

  function checkAndInjectModal() {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const modal of dialogs) {
      const text = modal.textContent || '';
      const isReadyToSend = text.includes('Ready to send') && (text.includes('personalized emails') || /send all/i.test(text));
      if (isReadyToSend) {
        injectScheduleButtonIntoModal(modal);
      }
    }
  }

  function injectScheduleButtonIntoModal(modal) {
    if (modal.querySelector('.' + MODAL_BTN_CLASS)) return;

    // Find the action buttons container inside the modal
    const actionContainer = modal.querySelector('div[role="group"]') || modal.querySelector('.gA.gt') || modal;

    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.className = MODAL_BTN_CLASS + ' T-I J-J5-Ji aoO v7 T-I-atl L3';
    scheduleBtn.innerHTML = '<span style="margin-right: 5px;">📅</span> Schedule for later';
    scheduleBtn.title = 'Schedule this mail merge dispatch for a future time';
    scheduleBtn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'height: 36px',
      'padding: 0 16px',
      'margin-right: 8px',
      'background: #ffffff',
      'color: #1a73e8',
      'border: 1px solid #dadce0',
      'border-radius: 18px',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif',
      'font-size: 13px',
      'font-weight: 500',
      'cursor: pointer',
      'user-select: none',
      'vertical-align: middle',
      'box-shadow: 0 1px 2px rgba(60, 64, 67, 0.15)',
      'transition: background 0.15s ease, border-color 0.15s ease',
      'z-index: 100'
    ].join('; ');

    scheduleBtn.addEventListener('mouseenter', () => {
      scheduleBtn.style.background = '#f8fafd';
      scheduleBtn.style.borderColor = '#1a73e8';
    });
    scheduleBtn.addEventListener('mouseleave', () => {
      scheduleBtn.style.background = '#ffffff';
      scheduleBtn.style.borderColor = '#dadce0';
    });

    scheduleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openScheduleDialog(modal);
    });

    // Insert before the "Cancel" button, or before "Send all", or append
    const cancelBtn = Array.from(modal.querySelectorAll('button, div[role="button"]'))
      .find((b) => /cancel/i.test((b.textContent || '').trim()));
    const sendAllBtn = Array.from(modal.querySelectorAll('button, div[role="button"]'))
      .find((b) => /send all/i.test((b.textContent || '').trim()));

    if (cancelBtn && cancelBtn.parentElement) {
      cancelBtn.parentElement.insertBefore(scheduleBtn, cancelBtn);
    } else if (sendAllBtn && sendAllBtn.parentElement) {
      sendAllBtn.parentElement.insertBefore(scheduleBtn, sendAllBtn);
    } else {
      actionContainer.appendChild(scheduleBtn);
    }
    console.log('[MailMerge ContentScript] Injected "Schedule for later" into "Ready to send" modal.');
  }

  function createSaveTemplateButton(composeDialog) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = SAVE_TPL_BTN_CLASS + ' T-I J-J5-Ji aoO v7 T-I-atl L3';
    btn.innerHTML = '<span style="margin-right: 4px;">💾</span> Save Template';
    btn.title = 'Save this draft as a reusable template with full formatting, colors & hyperlinks';
    btn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'height: 36px',
      'padding: 0 13px',
      'margin-left: 8px',
      'background: #ffffff',
      'color: #0284c7',
      'border: 1px solid #7dd3fc',
      'border-radius: 18px',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif',
      'font-size: 13px',
      'font-weight: 600',
      'cursor: pointer',
      'user-select: none',
      'vertical-align: middle',
      'box-shadow: 0 1px 2px rgba(2, 132, 199, 0.12)',
      'transition: background 0.15s ease, border-color 0.15s ease',
      'z-index: 100'
    ].join('; ');

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#f0f9ff';
      btn.style.borderColor = '#0284c7';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#ffffff';
      btn.style.borderColor = '#7dd3fc';
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDirectSaveTemplateModal(composeDialog);
    });
    return btn;
  }

  function createLoadTemplateButton(composeDialog) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = LOAD_TPL_BTN_CLASS + ' T-I J-J5-Ji aoO v7 T-I-atl L3';
    btn.innerHTML = '<span style="margin-right: 4px;">⚡</span> Templates';
    btn.title = 'Quick-load a saved template with full formatting & hyperlinks';
    btn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'height: 36px',
      'padding: 0 13px',
      'margin-left: 8px',
      'background: #ffffff',
      'color: #6366f1',
      'border: 1px solid #a5b4fc',
      'border-radius: 18px',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif',
      'font-size: 13px',
      'font-weight: 600',
      'cursor: pointer',
      'user-select: none',
      'vertical-align: middle',
      'box-shadow: 0 1px 2px rgba(99, 102, 241, 0.12)',
      'transition: background 0.15s ease, border-color 0.15s ease',
      'z-index: 100'
    ].join('; ');

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#eef2ff';
      btn.style.borderColor = '#6366f1';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#ffffff';
      btn.style.borderColor = '#a5b4fc';
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDirectLoadTemplateMenu(btn, composeDialog);
    });
    return btn;
  }

  function openDirectSaveTemplateModal(composeDialog) {
    const existing = document.getElementById('mm-direct-save-modal');
    if (existing) existing.remove();

    const compose = composeDialog || getComposeDialog();
    if (!compose) return;

    const subject = getSubject(compose) || '';
    const bodyEl = compose.querySelector('div[aria-label="Message Body"], div[role="textbox"], div.Am');
    const bodyHtml = bodyEl ? bodyEl.innerHTML : '';
    const bodyText = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '';

    if (!bodyText.trim() && !subject.trim()) {
      showToast('⚠️ Write something in the draft subject or body before saving.');
      return;
    }

    const defaultName = subject ? subject.slice(0, 40) : ('Template ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }));

    const overlay = document.createElement('div');
    overlay.id = 'mm-direct-save-modal';
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100vw',
      'height: 100vh',
      'background: rgba(32, 33, 36, 0.45)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 100002',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif'
    ].join('; ');

    overlay.innerHTML =
      '<div style="background: #ffffff; border-radius: 12px; width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); padding: 20px; box-sizing: border-box; position: relative;">' +
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">' +
          '<h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #202124; display: flex; align-items: center; gap: 8px;">' +
            '<span style="color: #0284c7;">💾</span> Save as Reusable Template' +
          '</h3>' +
          '<span id="mmDirectSaveClose" style="cursor: pointer; font-size: 18px; color: #5f6368; padding: 2px 6px; line-height: 1;">✕</span>' +
        '</div>' +
        '<div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 12px; color: #0369a1; line-height: 1.4;">' +
          '✨ <b>100% Rich Formatting:</b> All hyperlinks, text colors, font styles & bold text are saved directly to Dashboard templates.' +
        '</div>' +
        '<div style="margin-bottom: 12px;">' +
          '<label style="display: block; font-size: 11px; font-weight: 600; color: #3c4043; text-transform: uppercase; margin-bottom: 4px;">' +
            'Template Name' +
          '</label>' +
          '<input type="text" id="mmDirectSaveNameInput" value="' + escapeHtml(defaultName) + '" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 6px; font-size: 13px; outline: none;" placeholder="e.g. Outreach with Calendar Link" />' +
        '</div>' +
        '<div style="margin-bottom: 14px; font-size: 12px; color: #5f6368;">' +
          '<div><b>Subject:</b> ' + escapeHtml(subject || '(No Subject)') + '</div>' +
          '<div style="margin-top: 4px; max-height: 48px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' +
            '<b>Body preview:</b> ' + escapeHtml(bodyText.slice(0, 90)) + '...' +
          '</div>' +
        '</div>' +
        '<div style="display: flex; justify-content: flex-end; gap: 8px;">' +
          '<button type="button" id="mmDirectSaveCancel" style="background: transparent; border: 1px solid #dadce0; border-radius: 6px; padding: 8px 14px; font-size: 12px; font-weight: 500; cursor: pointer; color: #5f6368;">Cancel</button>' +
          '<button type="button" id="mmDirectSaveConfirm" style="background: #0284c7; color: #ffffff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">' +
            '💾 Save Template' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#mmDirectSaveNameInput');
    if (input) {
      input.focus();
      input.select();
    }

    const close = () => overlay.remove();
    overlay.querySelector('#mmDirectSaveClose').addEventListener('click', close);
    overlay.querySelector('#mmDirectSaveCancel').addEventListener('click', close);

    overlay.querySelector('#mmDirectSaveConfirm').addEventListener('click', async () => {
      const name = input.value.trim() || defaultName;
      const meta = extractDraftMetadata(compose);
      const newTpl = {
        id: 'tpl_' + Date.now(),
        name: name,
        subject: subject || '',
        body: bodyText,
        bodyHtml: bodyHtml,
        mergeTags: meta.mergeTags || [],
        createdAt: new Date().toISOString()
      };

      try {
        if (root.IDBStore) {
          await root.IDBStore.saveTemplate(newTpl);
          close();
          showToast('💾 Template "' + name + '" saved with all formatting & hyperlinks!');
        }
      } catch (err) {
        alert('Failed to save template: ' + err.message);
      }
    });
  }

  async function openDirectLoadTemplateMenu(anchorBtn, composeDialog) {
    const existing = document.getElementById('mm-direct-load-menu');
    if (existing) {
      existing.remove();
      return;
    }

    const compose = composeDialog || getComposeDialog();
    if (!compose) return;

    let tpls = [];
    try {
      if (root.IDBStore) {
        tpls = await root.IDBStore.getTemplates();
      }
    } catch (e) {
      console.warn('[MailMerge ContentScript] Error fetching templates:', e);
    }

    const rect = anchorBtn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'mm-direct-load-menu';
    menu.style.cssText = [
      'position: fixed',
      'left: ' + Math.max(10, rect.left) + 'px',
      'bottom: ' + (window.innerHeight - rect.top + 8) + 'px',
      'width: 320px',
      'background: #ffffff',
      'border: 1px solid #dadce0',
      'border-radius: 10px',
      'box-shadow: 0 8px 24px rgba(0,0,0,0.22)',
      'z-index: 100002',
      'padding: 8px 0',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif',
      'max-height: 360px',
      'overflow-y: auto'
    ].join('; ');

    let listHtml = '';
    if (!tpls || tpls.length === 0) {
      listHtml = '<div style="padding: 16px; font-size: 12px; color: #5f6368; text-align: center;">No saved templates yet.<br>Click "<b>💾 Save Template</b>" to create one!</div>';
    } else {
      listHtml = tpls.map((t) => {
        return (
          '<div class="mm-tpl-item" data-id="' + escapeHtml(t.id) + '" style="padding: 8px 14px; cursor: pointer; border-bottom: 1px solid #f1f3f4; transition: background 0.12s ease;">' +
            '<div style="font-size: 13px; font-weight: 600; color: #202124; display: flex; align-items: center; justify-content: space-between;">' +
              '<span>' + escapeHtml(t.name || 'Untitled') + '</span>' +
              '<span style="font-size: 10px; color: #1a73e8; background: #e8f0fe; padding: 1px 6px; border-radius: 10px; font-weight: 500;">Insert</span>' +
            '</div>' +
            (t.subject ? '<div style="font-size: 11px; color: #5f6368; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Subject: ' + escapeHtml(t.subject) + '</div>' : '') +
          '</div>'
        );
      }).join('');
    }

    menu.innerHTML =
      '<div style="padding: 6px 14px 8px; border-bottom: 1px solid #dadce0; display: flex; justify-content: space-between; align-items: center;">' +
        '<span style="font-size: 12px; font-weight: 700; color: #6366f1; text-transform: uppercase;">⚡ Quick Load Template</span>' +
        '<span id="mmLoadMenuClose" style="cursor: pointer; font-size: 14px; color: #5f6368;">✕</span>' +
      '</div>' +
      '<div class="mm-tpl-list-container">' +
        listHtml +
      '</div>' +
      '<div style="padding: 8px 14px 4px; border-top: 1px solid #dadce0; text-align: right;">' +
        '<button type="button" id="mmLoadMenuManage" style="background: none; border: none; font-size: 11px; color: #9333ea; font-weight: 600; cursor: pointer; text-decoration: underline; padding: 0;">' +
          '📋 Manage in Dashboard ↗' +
        '</button>' +
      '</div>';

    document.body.appendChild(menu);

    // Adjust position if overflowing viewport top
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.top < 10) {
      menu.style.bottom = 'auto';
      menu.style.top = (rect.bottom + 8) + 'px';
    }

    menu.querySelector('#mmLoadMenuClose').addEventListener('click', () => menu.remove());

    const manageBtn = menu.querySelector('#mmLoadMenuManage');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        menu.remove();
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD', targetTab: 'tab-templates' }).catch(() => {});
        } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          window.open(chrome.runtime.getURL('src/dashboard/dashboard.html#tab-templates'), '_blank');
        }
      });
    }

    menu.querySelectorAll('.mm-tpl-item').forEach((item) => {
      item.addEventListener('mouseenter', () => { item.style.background = '#f8f9fa'; });
      item.addEventListener('mouseleave', () => { item.style.background = '#ffffff'; });
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const chosen = tpls.find((t) => t.id === id);
        if (chosen) {
          // Apply subject
          if (chosen.subject !== undefined) {
            const subInput = compose.querySelector('input[name="subjectbox"], input[name="subject"]');
            if (subInput) {
              subInput.value = chosen.subject;
              subInput.dispatchEvent(new Event('input', { bubbles: true }));
              subInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          // Apply body with full rich text & links
          const bodyEl = compose.querySelector('div[aria-label="Message Body"], div[role="textbox"], div.Am');
          if (bodyEl) {
            if (chosen.bodyHtml) {
              bodyEl.innerHTML = chosen.bodyHtml;
            } else {
              bodyEl.innerText = chosen.body || '';
            }
            bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
            bodyEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          menu.remove();
          showToast('⚡ Loaded template "' + (chosen.name || 'Template') + '" with hyperlinks & styles!');
        }
      });
    });

    // Close on outside click
    const outsideClickListener = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', outsideClickListener, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', outsideClickListener, true);
    }, 50);
  }

  function checkAndInjectComposeButtons() {
    // 1. Check native "Continue" buttons (when Mail Merge is active in Gmail)
    const buttons = document.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim();
      if (/^Continue$/i.test(txt)) {
        if (!btn.parentElement || btn.parentElement.querySelector('.' + INLINE_BTN_CLASS)) continue;
        injectButtonsNextToContinue(btn);
      }
    }

    // 2. Check standard compose windows (before or without clicking Mail Merge)
    const dialogs = document.querySelectorAll('div[role="dialog"], div.M9, div.AD');
    for (const dialog of dialogs) {
      const bodyEl = dialog.querySelector('div[aria-label="Message Body"], div[role="textbox"], div.Am');
      if (!bodyEl) continue;

      // If already has our save button, skip
      if (dialog.querySelector('.' + SAVE_TPL_BTN_CLASS)) continue;

      // Don't inject if Continue button exists (handled by injectButtonsNextToContinue)
      const hasContinue = Array.from(dialog.querySelectorAll('button, div[role="button"]'))
        .some(b => /^Continue$/i.test((b.textContent || '').trim()));
      if (hasContinue) continue;

      // Find the Send button
      const sendBtn = Array.from(dialog.querySelectorAll('button, div[role="button"]'))
        .find(b => {
          const t = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || b.textContent || '').trim();
          return /^Send/i.test(t) || b.classList.contains('aoO');
        });

      if (sendBtn && sendBtn.parentElement) {
        injectStandardComposeButtons(sendBtn, dialog);
      }
    }
  }

  function injectButtonsNextToContinue(continueBtn) {
    const composeDialog = continueBtn.closest('div[role="dialog"]') || getComposeDialog();

    // 1. Schedule button
    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.className = INLINE_BTN_CLASS + ' T-I J-J5-Ji aoO v7 T-I-atl L3';
    scheduleBtn.innerHTML = '<span style="margin-right: 4px;">📅</span> Schedule';
    scheduleBtn.title = 'Schedule this native mail merge for later';
    scheduleBtn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'height: 36px',
      'padding: 0 14px',
      'margin-left: 8px',
      'background: #ffffff',
      'color: #7e22ce',
      'border: 1px solid #c084fc',
      'border-radius: 18px',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif',
      'font-size: 13px',
      'font-weight: 600',
      'cursor: pointer',
      'user-select: none',
      'vertical-align: middle',
      'box-shadow: 0 1px 2px rgba(126, 34, 206, 0.15)',
      'transition: background 0.15s ease, border-color 0.15s ease',
      'z-index: 100'
    ].join('; ');

    scheduleBtn.addEventListener('mouseenter', () => {
      scheduleBtn.style.background = '#fbf8ff';
      scheduleBtn.style.borderColor = '#7e22ce';
    });
    scheduleBtn.addEventListener('mouseleave', () => {
      scheduleBtn.style.background = '#ffffff';
      scheduleBtn.style.borderColor = '#c084fc';
    });
    scheduleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openScheduleDialog(continueBtn);
    });

    // 2. Save Template button
    const saveTplBtn = createSaveTemplateButton(composeDialog);

    // 3. Load Template button
    const loadTplBtn = createLoadTemplateButton(composeDialog);

    continueBtn.parentElement.insertBefore(scheduleBtn, continueBtn.nextSibling);
    continueBtn.parentElement.insertBefore(saveTplBtn, scheduleBtn.nextSibling);
    continueBtn.parentElement.insertBefore(loadTplBtn, saveTplBtn.nextSibling);
    console.log('[MailMerge ContentScript] Injected "Schedule", "Save Template", and "Templates" buttons next to Continue.');
  }

  function injectStandardComposeButtons(sendBtn, composeDialog) {
    const saveTplBtn = createSaveTemplateButton(composeDialog);
    const loadTplBtn = createLoadTemplateButton(composeDialog);
    sendBtn.parentElement.insertBefore(saveTplBtn, sendBtn.nextSibling);
    sendBtn.parentElement.insertBefore(loadTplBtn, saveTplBtn.nextSibling);
    console.log('[MailMerge ContentScript] Injected "Save Template" and "Templates" buttons in standard compose window.');
  }

  // =========================================================================
  // SCHEDULING DIALOG / POPOVER & METADATA CAPTURE
  // =========================================================================

  function openScheduleDialog(anchorElement) {
    const existing = document.getElementById('mm-schedule-popover-card');
    if (existing) existing.remove();

    // Scoped strictly to the specific compose window where schedule was clicked
    const composeDialog = anchorElement?.closest('div[role="dialog"]') || getComposeDialog();
    const subject = getSubject(composeDialog);
    let meta = extractDraftMetadata(composeDialog);

    // If scheduled directly from the "Ready to send" modal, merge metadata from underlying compose dialog
    if (!meta.sheetTitle || !meta.sheetUrl) {
      const activeCompose = getComposeDialog();
      if (activeCompose && activeCompose !== composeDialog) {
        const composeMeta = extractDraftMetadata(activeCompose);
        meta.sheetId = meta.sheetId || composeMeta.sheetId;
        meta.sheetUrl = meta.sheetUrl || composeMeta.sheetUrl;
        meta.sheetTitle = meta.sheetTitle || composeMeta.sheetTitle;
        if (!meta.recipientCount && composeMeta.recipientCount) {
          meta.recipientCount = composeMeta.recipientCount;
          meta.recipientsSummary = composeMeta.recipientsSummary;
        }
      }
    }

    // Compute default time: Real-time current local time
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const defaultTimeStr = localNow.toISOString().slice(0, 16);

    const minDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000 - 60000);
    const minTimeStr = minDate.toISOString().slice(0, 16);

    // Create Popover Card
    const overlay = document.createElement('div');
    overlay.id = 'mm-schedule-popover-card';
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100vw',
      'height: 100vh',
      'background: rgba(32, 33, 36, 0.4)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 100000',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif'
    ].join('; ');

    const sheetInfoHtml = meta.sheetTitle
      ? '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">' +
          '<span style="font-weight: 600; color: #137333;">📊 ' + escapeHtml(meta.sheetTitle) + '</span>' +
          (meta.recipientCount ? '<span style="color: #1a73e8; font-weight: 500;">👥 ' + meta.recipientCount + ' recipients</span>' : '') +
        '</div>' +
        (meta.sheetUrl ? '<div style="font-size: 11px; margin-bottom: 4px;"><a href="' + meta.sheetUrl + '" target="_blank" style="color: #1a73e8; text-decoration: none;">View Spreadsheet ↗</a></div>' : '')
      : '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">' +
          '<span style="font-weight: 500; color: #5f6368;">✉️ Direct Mail Merge</span>' +
          (meta.recipientCount ? '<span style="color: #1a73e8; font-weight: 500;">👥 ' + meta.recipientCount + ' recipients</span>' : '') +
        '</div>';

    const tagsHtml = (meta.mergeTags && meta.mergeTags.length > 0)
      ? '<div style="font-size: 11px; color: #5f6368; margin-top: 4px;">Tags: <b>' + escapeHtml(meta.mergeTags.join(', ')) + '</b></div>'
      : '';

    overlay.innerHTML =
      '<div style="background: #ffffff; border-radius: 12px; width: 390px; box-shadow: 0 8px 28px rgba(0,0,0,0.28); padding: 20px; box-sizing: border-box; position: relative;">' +
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">' +
          '<h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #202124; display: flex; align-items: center; gap: 8px;">' +
            '<span style="color: #7e22ce;">📅</span> Schedule Mail Merge' +
          '</h3>' +
          '<span id="mmPopoverClose" style="cursor: pointer; font-size: 18px; color: #5f6368; padding: 2px 6px; line-height: 1;">✕</span>' +
        '</div>' +

        // Detected Draft & Sheet Metadata Preview
        '<div style="background: #f8f9fa; border: 1px solid #dadce0; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px;">' +
          '<div style="font-size: 11px; color: #5f6368; text-transform: uppercase; font-weight: 600; margin-bottom: 2px;">Subject</div>' +
          '<div class="mm-subject-preview" style="font-size: 13px; color: #202124; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px;">' +
            escapeHtml(subject || '(No Subject)') +
          '</div>' +
          sheetInfoHtml +
          tagsHtml +
        '</div>' +

        // Reusable Template Quick-Load Bar
        '<div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;">' +
          '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
            '<label for="mmTemplateSelectDropdown" style="font-size: 11px; font-weight: 700; color: #7e22ce; text-transform: uppercase;">' +
              '⚡ Load Saved Template' +
            '</label>' +
            '<button type="button" id="mmBtnOpenTemplatesDashboard" style="background: transparent; border: none; color: #9333ea; font-size: 11px; font-weight: 600; cursor: pointer; text-decoration: underline; padding: 0;">' +
              '📋 Manage Templates' +
            '</button>' +
          '</div>' +
          '<select id="mmTemplateSelectDropdown" style="width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #d8b4fe; border-radius: 6px; font-size: 12px; outline: none; background: #ffffff; color: #374151; cursor: pointer;">' +
            '<option value="">-- Choose Template to Load into Draft --</option>' +
          '</select>' +
        '</div>' +

        '<div style="margin-bottom: 14px;">' +
          '<label style="display: block; font-size: 11px; font-weight: 600; color: #3c4043; text-transform: uppercase; margin-bottom: 4px;">' +
            'Dispatch Date & Time (Real Time)' +
          '</label>' +
          '<input type="datetime-local" id="mmDateTimeInput" value="' + defaultTimeStr + '" min="' + minTimeStr + '" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 6px; font-size: 13px; outline: none; font-family: inherit;" />' +
        '</div>' +
        '<div style="display: flex; gap: 6px; margin-bottom: 14px;">' +
          '<button type="button" class="mm-quick-time" data-offset="now" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043; font-weight: 600;">Now</button>' +
          '<button type="button" class="mm-quick-time" data-offset="2" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+2m</button>' +
          '<button type="button" class="mm-quick-time" data-offset="5" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+5m</button>' +
          '<button type="button" class="mm-quick-time" data-offset="15" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+15m</button>' +
          '<button type="button" class="mm-quick-time" data-offset="30" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+30m</button>' +
        '</div>' +
        '<label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4b5563; margin-bottom: 14px; cursor: pointer; user-select: none;">' +
          '<input type="checkbox" id="mmSaveAsTemplateCheckbox" style="cursor: pointer; width: 15px; height: 15px;" />' +
          '<span>💾 Save as reusable template in Dashboard</span>' +
        '</label>' +
        '<div id="mmAlertBox" style="display: none; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;"></div>' +
        '<div style="display: flex; justify-content: flex-end; gap: 8px;">' +
          '<button type="button" id="mmPopoverCancel" style="background: transparent; border: 1px solid #dadce0; border-radius: 6px; padding: 8px 14px; font-size: 12px; font-weight: 500; cursor: pointer; color: #5f6368;">Cancel</button>' +
          '<button type="button" id="mmPopoverConfirm" style="background: #7e22ce; color: #ffffff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">' +
            'Schedule & Save Draft' +
          '</button>' +
        '</div>' +
      '</div>';

    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Schedule Mail Merge');
    document.body.appendChild(overlay);

    setTimeout(() => {
      const input = overlay.querySelector('#mmDateTimeInput');
      if (input) input.focus();
    }, 100);

    // Quick time button handlers
    overlay.querySelectorAll('.mm-quick-time').forEach((btn) => {
      btn.addEventListener('click', () => {
        const offset = btn.getAttribute('data-offset');
        const dt = new Date();
        if (offset === 'now') {
          // current minute
        } else if (offset === '2') {
          dt.setMinutes(dt.getMinutes() + 2);
        } else if (offset === '5') {
          dt.setMinutes(dt.getMinutes() + 5);
        } else if (offset === '15') {
          dt.setMinutes(dt.getMinutes() + 15);
        } else if (offset === '30') {
          dt.setMinutes(dt.getMinutes() + 30);
        }
        dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
        overlay.querySelector('#mmDateTimeInput').value = dt.toISOString().slice(0, 16);
      });
    });

    // Template Dropdown Population & Loading
    const templateSelect = overlay.querySelector('#mmTemplateSelectDropdown');
    const btnOpenDash = overlay.querySelector('#mmBtnOpenTemplatesDashboard');

    if (templateSelect && root.IDBStore) {
      root.IDBStore.getTemplates().then((tpls) => {
        if (tpls && tpls.length > 0) {
          tpls.forEach((t) => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = (t.name || 'Untitled Template') + (t.subject ? ' — "' + t.subject + '"' : '');
            templateSelect.appendChild(opt);
          });
        } else {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '(No saved templates yet)';
          opt.disabled = true;
          templateSelect.appendChild(opt);
        }
      }).catch((e) => console.warn('[MailMerge ContentScript] Error fetching templates for dialog:', e));

      templateSelect.addEventListener('change', async () => {
        const tplId = templateSelect.value;
        if (!tplId) return;
        try {
          const tpls = await root.IDBStore.getTemplates();
          const chosen = tpls.find((t) => t.id === tplId);
          if (chosen) {
            // Apply subject to compose dialog
            if (chosen.subject !== undefined && composeDialog) {
              const subInput = composeDialog.querySelector('input[name="subjectbox"], input[name="subject"]');
              if (subInput) {
                subInput.value = chosen.subject;
                subInput.dispatchEvent(new Event('input', { bubbles: true }));
                subInput.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            // Apply body to compose dialog with full rich text & links
            if ((chosen.bodyHtml !== undefined || chosen.body !== undefined) && composeDialog) {
              const bodyEl = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"], div.Am');
              if (bodyEl) {
                if (chosen.bodyHtml) {
                  bodyEl.innerHTML = chosen.bodyHtml;
                } else {
                  bodyEl.innerText = chosen.body || '';
                }
                bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
                bodyEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            // Update preview in popup if present
            const subPreview = overlay.querySelector('.mm-subject-preview');
            if (subPreview && chosen.subject) {
              subPreview.textContent = chosen.subject;
            }
            showToast('⚡ Template "' + (chosen.name || 'Template') + '" loaded with formatting & links!');
          }
        } catch (err) {
          console.error('[MailMerge ContentScript] Error loading template into compose:', err);
        }
      });
    }

    if (btnOpenDash) {
      btnOpenDash.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD', targetTab: 'tab-templates' }).catch(() => {});
        } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          window.open(chrome.runtime.getURL('src/dashboard/dashboard.html#tab-templates'), '_blank');
        }
      });
    }

    const closePopover = () => {
      if (anchorElement && typeof anchorElement.focus === 'function') {
        try { anchorElement.focus(); } catch (_) {}
      }
      overlay.remove();
    };
    overlay.querySelector('#mmPopoverClose').addEventListener('click', closePopover);
    overlay.querySelector('#mmPopoverCancel').addEventListener('click', closePopover);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePopover();
    });

    // Confirmation Handler
    const confirmBtn = overlay.querySelector('#mmPopoverConfirm');
    const dtInput = overlay.querySelector('#mmDateTimeInput');
    const alertBox = overlay.querySelector('#mmAlertBox');

    confirmBtn.addEventListener('click', async () => {
      const val = dtInput.value;
      if (!val) {
        alertBox.textContent = 'Please choose a date and time.';
        alertBox.style.display = 'block';
        alertBox.style.background = '#fce8e6';
        alertBox.style.color = '#c5221f';
        return;
      }

      const scheduledTime = new Date(val).getTime();
      if (isNaN(scheduledTime) || scheduledTime < Date.now() - 60000) {
        alertBox.textContent = 'Scheduled time cannot be in the past.';
        alertBox.style.display = 'block';
        alertBox.style.background = '#fce8e6';
        alertBox.style.color = '#c5221f';
        return;
      }

      // Safety Guard 1: Enforce Non-Empty Subject
      const currentSubject = (getSubject(composeDialog) || subject || '').trim();
      if (!currentSubject || currentSubject === '(No Subject)' || currentSubject.startsWith('Mail Merge (')) {
        alertBox.textContent = '⚠️ Please enter a clear email subject in your draft before scheduling.';
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef3c7';
        alertBox.style.color = '#92400e';
        return;
      }

      // Safety Guard 2: Enforce Mail Merge Connection (Google Sheet attached or merge recipients detected)
      let currentMeta = extractDraftMetadata(composeDialog);
      if (!currentMeta.sheetId && !currentMeta.sheetTitle && !meta.sheetId && !meta.sheetTitle && !meta.recipientCount) {
        alertBox.textContent = '⚠️ Please connect a Google Sheet via Mail Merge before scheduling. Regular emails cannot be scheduled.';
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef3c7';
        alertBox.style.color = '#92400e';
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Verifying draft on server...';

      try {
        if (!root.IDBStore) {
          throw new Error('IDBStore is not available');
        }

        // Safety Guard 3: Ensure Draft ID is saved & permanent on Google server
        const verifiedDraftId = await ensureDraftSaved(composeDialog);
        if (!verifiedDraftId || verifiedDraftId === 'unknown') {
          alertBox.textContent = '⚠️ Gmail has not finished saving this draft yet. Please wait a moment and try again.';
          alertBox.style.display = 'block';
          alertBox.style.background = '#fef3c7';
          alertBox.style.color = '#92400e';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Schedule & Save Draft';
          return;
        }

        confirmBtn.textContent = 'Scheduling...';

        // 2. Detect current user account index (/u/0/, /u/1/, etc.) from URL
        const userMatch = /\/u\/(\d+)/.exec(window.location.pathname);
        const userIndex = userMatch ? userMatch[1] : '0';

        // 3. Detect current account email
        let accountEmail = '';
        try {
          const accountEl = document.querySelector('header a[aria-label*="@"], div[aria-label*="@"], a[aria-label*="Google Account"]');
          if (accountEl) {
            const emailMatch = /[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/.exec(accountEl.getAttribute('aria-label') || '');
            if (emailMatch) accountEmail = emailMatch[0];
          }
        } catch (_) {}

        // 4. Build comprehensive campaign record
        const campaign = {
          id: 'camp_' + Date.now(),
          draftId: verifiedDraftId,
          subject: subject,
          userIndex: userIndex,
          accountEmail: accountEmail,
          accountUrl: window.location.origin + (userMatch ? `/mail/u/${userIndex}/` : '/mail/u/0/'),
          scheduledAt: new Date(scheduledTime).toISOString(),
          status: 'QUEUED',
          isNative: true,
          createdAt: new Date().toISOString(),
          // Complete Draft & Sheet Metadata:
          sheetId: meta.sheetId,
          sheetUrl: meta.sheetUrl,
          sheetTitle: meta.sheetTitle,
          recipientCount: meta.recipientCount,
          recipientsSummary: meta.recipientsSummary,
          mergeTags: meta.mergeTags,
          bodySnippet: meta.bodySnippet,
          attachmentCount: meta.attachmentCount,
          metadata: meta
        };

        await root.IDBStore.saveCampaign(campaign);
        await root.IDBStore.addLog(campaign.id, 'INFO', 'Scheduled native mail merge for ' + new Date(scheduledTime).toLocaleString());

        // Check if user checked "Save as reusable template"
        let templateSaved = false;
        const saveAsTplCheckbox = overlay.querySelector('#mmSaveAsTemplateCheckbox');
        if (saveAsTplCheckbox && saveAsTplCheckbox.checked) {
          try {
            const bodyEl = composeDialog?.querySelector('div[aria-label="Message Body"], div[role="textbox"], div.Am');
            const fullBodyHtml = bodyEl ? (bodyEl.innerHTML || '') : '';
            const fullBodyText = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : (meta.bodySnippet || '');
            const newTpl = {
              id: 'tpl_' + Date.now(),
              name: (subject || 'Saved Template') + ' (' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')',
              subject: subject || '',
              body: fullBodyText,
              bodyHtml: fullBodyHtml,
              mergeTags: meta.mergeTags || [],
              createdAt: new Date().toISOString()
            };
            await root.IDBStore.saveTemplate(newTpl);
            templateSaved = true;
            console.log('[MailMerge ContentScript] Saved reusable template with rich formatting to Dashboard:', newTpl.name);
          } catch (tplErr) {
            console.warn('[MailMerge ContentScript] Error saving template:', tplErr.message);
          }
        }

        // Register alarm and persist campaign into central background database
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          try {
            await chrome.runtime.sendMessage({
              action: 'REGISTER_SCHEDULED_ALARM',
              campaignId: campaign.id,
              campaign: campaign,
              scheduledTime: scheduledTime
            });
          } catch (commErr) {
            console.warn('[MailMerge ContentScript] Background registration note:', commErr?.message);
            if (commErr && commErr.message && commErr.message.includes('Extension context invalidated')) {
              throw new Error('Extension was updated in Chrome. Please press F5 to refresh this Gmail tab and click Schedule again.');
            }
          }
        }

        closePopover();

        // Strictly close ONLY this specific compose dialog (preserves other open windows)
        closeSpecificCompose(composeDialog);

        // Show toast confirmation
        showToast('✅ Scheduled for ' + new Date(scheduledTime).toLocaleString() + (meta.recipientCount ? ' (' + meta.recipientCount + ' recipients)' : '') + (templateSaved ? ' • 💾 Template saved to Dashboard!' : ''));
      } catch (err) {
        console.error('[MailMerge ContentScript] Failed to schedule:', err);
        if (err && err.message && err.message.includes('Extension context invalidated')) {
          alertBox.textContent = '⚠️ Extension was updated. Please press F5 to refresh this Gmail tab and click Schedule again.';
          alertBox.style.background = '#feefe3';
          alertBox.style.color = '#b06000';
        } else {
          alertBox.textContent = 'Error: ' + (err?.message || err);
          alertBox.style.background = '#fce8e6';
          alertBox.style.color = '#c5221f';
        }
        alertBox.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Schedule & Save Draft';
      }
    });
  }

  // =========================================================================
  // HELPER FUNCTIONS
  // =========================================================================

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getComposeDialog() {
    const dialogs = document.querySelectorAll('div[role="dialog"], div.M9, div.AD');
    for (const d of dialogs) {
      if (d.querySelector('input[name="subjectbox"]') || d.querySelector('[aria-label="Message Body"]')) {
        return d;
      }
    }
    return null;
  }

  function getDraftId(target) {
    // 1. Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('compose')) return urlParams.get('compose');
    if (window.location.hash && window.location.hash.includes('compose=')) {
      const match = window.location.hash.match(/compose=([^&]+)/);
      if (match) return match[1];
    }

    // 2. Check compose dialog directly
    const composeDialog = (target && target.matches && target.matches('div[role="dialog"], div.M9, div.AD'))
      ? target
      : (target?.closest ? target.closest('div[role="dialog"]') : getComposeDialog());

    if (composeDialog) {
      const draftInput = composeDialog.querySelector('input[name="draft"]');
      if (draftInput && draftInput.value) return draftInput.value;
      const composeId = composeDialog.getAttribute('data-compose-id');
      if (composeId) return composeId;
    }

    const globalDraftInput = document.querySelector('input[name="draft"]');
    if (globalDraftInput && globalDraftInput.value) return globalDraftInput.value;

    return 'unknown';
  }

  function getSubject(target) {
    const composeDialog = (target && target.matches && target.matches('div[role="dialog"], div.M9, div.AD'))
      ? target
      : (target?.closest ? target.closest('div[role="dialog"]') : getComposeDialog());

    if (composeDialog) {
      const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
      if (subjectInput && subjectInput.value.trim()) return subjectInput.value.trim();
    }
    const globalSubject = document.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
    if (globalSubject && globalSubject.value.trim()) return globalSubject.value.trim();
    return 'Mail Merge (' + new Date().toLocaleDateString() + ')';
  }

  // Ponytail-lean: extracts all draft metadata in ~35 lines
  function extractDraftMetadata(composeDialog) {
    if (!composeDialog) return {};

    // 1. Google Sheet ID, URL & Title
    let sheetId = null;
    let sheetTitle = null;
    const sheetLink = composeDialog.querySelector('a[href*="spreadsheets/d/"], [data-url*="spreadsheets/d/"]');
    if (sheetLink) {
      const url = sheetLink.href || sheetLink.getAttribute('data-url') || '';
      const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i);
      if (match) sheetId = match[1];
      sheetTitle = (sheetLink.textContent || '').trim() || null;
    }
    if (!sheetTitle) {
      const chip = composeDialog.querySelector('div[role="button"][aria-label*="sheet" i], div.vR, div.afV, span[aria-label*="sheet" i]');
      if (chip) sheetTitle = (chip.textContent || '').replace(/close|remove|delete|spreadsheet/gi, '').trim() || null;
    }
    const sheetUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null;

    // 2. Recipients & Audience
    const recipientChips = Array.from(composeDialog.querySelectorAll('span[email], div[email], div[data-hovercard-id]'));
    let recipientCount = recipientChips.length;
    const emails = recipientChips.map(c => c.getAttribute('email') || c.getAttribute('data-hovercard-id') || c.textContent.trim()).filter(Boolean);
    const textContent = composeDialog.textContent || '';
    const countMatch = textContent.match(/(?:send|about to send)?\s*(\d+)\s*(?:separate|personalized)?\s*(?:emails?|recipients?)\b/i)
      || textContent.match(/(\d+)\s*(?:separate|personalized)?\s*emails?\b/i)
      || textContent.match(/(\d+)\s+recipients?\b/i);
    if (countMatch && parseInt(countMatch[1], 10) > 0) {
      recipientCount = parseInt(countMatch[1], 10);
    }
    const recipientsSummary = emails.slice(0, 3).join(', ') + (emails.length > 3 ? ` +${emails.length - 3} more` : (emails.length > 0 ? '' : (recipientCount ? `${recipientCount} recipients` : '')));

    // 3. Body Snippet & Merge Tags
    const bodyEl = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"], div.Am');
    const bodyText = (bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '').trim();
    const bodySnippet = bodyText.slice(0, 180);

    const fullText = (getSubject(composeDialog) + ' ' + bodyText);
    const atMatches = fullText.match(/@[\w\s]{2,25}\b/g) || [];
    const curlyMatches = fullText.match(/\{\{[\w\s]+\}\}/g) || [];
    const mergeTags = [...new Set([...atMatches, ...curlyMatches].map(t => t.trim()))].slice(0, 8);

    const attachmentChips = composeDialog.querySelectorAll('div[aria-label*="Attachment" i], div.dQ');

    return {
      sheetId,
      sheetUrl,
      sheetTitle,
      recipientCount,
      recipientsSummary,
      mergeTags,
      bodySnippet,
      attachmentCount: attachmentChips.length
    };
  }

  // Ponytail: ensure draft is fully saved to Google servers before scheduling
  async function ensureDraftSaved(composeDialog) {
    let draftId = getDraftId(composeDialog);
    if (draftId && draftId !== 'unknown') return draftId;

    const subjectInput = composeDialog?.querySelector('input[name="subjectbox"]');
    if (subjectInput) {
      subjectInput.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    const startTime = Date.now();
    while (Date.now() - startTime < 3500) {
      await new Promise((r) => setTimeout(r, 400));
      draftId = getDraftId(composeDialog);
      if (draftId && draftId !== 'unknown') return draftId;
    }
    return draftId || 'unknown';
  }

  // Strictly close ONLY the clicked compose dialog (preserves other open compose windows)
  function closeSpecificCompose(composeDialog) {
    if (!composeDialog) return;
    const modals = document.querySelectorAll('div[role="dialog"]');
    for (const modal of modals) {
      if (modal.textContent.includes('Ready to send')) {
        const cancelBtn = Array.from(modal.querySelectorAll('button, div[role="button"]'))
          .find((b) => /cancel/i.test((b.textContent || '').trim()));
        if (cancelBtn) cancelBtn.click();
      }
    }

    setTimeout(() => {
      const closeBtn =
        composeDialog.querySelector('button[aria-label*="Close" i]') ||
        composeDialog.querySelector('button[aria-label*="Save & close" i]') ||
        composeDialog.querySelector('img[aria-label*="Close" i]') ||
        composeDialog.querySelector('img[aria-label*="Save & close" i]') ||
        composeDialog.querySelector('img.Ha') ||
        composeDialog.querySelector('button[aria-label*="Discard" i]');
      if (closeBtn) {
        closeBtn.click();
      }
    }, 300);
  }

  function showToast(message) {
    const existing = document.getElementById('mm-schedule-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'mm-schedule-toast';
    toast.style.cssText = [
      'position: fixed',
      'bottom: 24px',
      'left: 24px',
      'background: #202124',
      'color: #ffffff',
      'padding: 12px 20px',
      'border-radius: 6px',
      'font-family: Roboto, RobotoDraft, Helvetica, Arial, sans-serif',
      'font-size: 13px',
      'box-shadow: 0 4px 14px rgba(0,0,0,0.3)',
      'z-index: 1000000',
      'display: flex',
      'align-items: center',
      'gap: 10px',
      'transition: opacity 0.3s ease'
    ].join('; ');
    toast.innerHTML = '<span>' + message + '</span>';
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  // =========================================================================
  // RUNTIME MESSAGE LISTENER (Triggered when scheduled alarm wakes up)
  // =========================================================================

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[MailMerge ContentScript] Message received: ' + message?.action);

      if (message.action === 'PING') {
        sendResponse({ success: true, ready: true });
        return true;
      }

      if (message.action === 'REQUEST_CAMPAIGN_SYNC') {
        syncCampaignsToBackground().then(() => sendResponse({ success: true }));
        return true;
      }

      if (message.action === 'EXECUTE_CAMPAIGN') {
        const campaign = message.campaign;
        console.log('[MailMerge ContentScript] Executing scheduled campaign: ' + (campaign?.subject || campaign?.id));

        if (!root.GmailAutomator || typeof root.GmailAutomator.executeScheduledNativeMerge !== 'function') {
          sendResponse({ success: false, error: 'GmailAutomator not found' });
          return false;
        }

        // Asynchronous execution - properly waits for completion
        root.GmailAutomator.executeScheduledNativeMerge(campaign.draftId, campaign)
          .then((result) => sendResponse(result || { success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));

        return true; // keep message channel open
      }

      if (message.action === 'SHOW_MISSED_OFFLINE_BANNER') {
        if (message.campaign && !dismissedBannerCampaignIds.has(message.campaign.id)) {
          showMissedOfflineBanner(message.campaign);
        }
        sendResponse({ success: true });
        return true;
      }

      if (message.action === 'CHECK_IS_USER_EDITING_DRAFT') {
        const targetDraftId = message.draftId;
        const targetSubject = (message.subject || '').trim().toLowerCase();
        const now = Date.now();
        const isRecentlyActive = (now - lastUserTypingTime) < 30000; // within 30 seconds

        let isEditingTarget = false;
        if (isRecentlyActive) {
          const activeCompose = getComposeDialog();
          if (activeCompose) {
            const activeId = getDraftId(activeCompose);
            const activeSub = (getSubject(activeCompose) || '').trim().toLowerCase();
            if ((targetDraftId && targetDraftId !== 'unknown' && activeId === targetDraftId) ||
                (targetSubject && activeSub && (activeSub.includes(targetSubject) || targetSubject.includes(activeSub)))) {
              isEditingTarget = true;
            }
          }
        }
        sendResponse({ isEditing: isEditingTarget });
        return true;
      }
    });
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
