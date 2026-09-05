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

  // =========================================================================
  // DOM OBSERVERS (Modal & Compose "Continue" Button)
  // =========================================================================

  // Observer 1: Watch for Gmail's native "Ready to send" modal
  const modalObserver = new MutationObserver(() => {
    checkAndInjectModal();
  });
  modalObserver.observe(document.body, { childList: true, subtree: true });

  // Observer 2: Watch for Gmail's native purple "Continue" button in compose dialogs
  const composeObserver = new MutationObserver(() => {
    checkAndInjectContinue();
  });
  composeObserver.observe(document.body, { childList: true, subtree: true });

  // Initial immediate checks
  checkAndInjectModal();
  checkAndInjectContinue();

  // Periodic safety scan (ensures dynamic single-page Gmail view changes never miss buttons)
  setInterval(() => {
    checkAndInjectModal();
    checkAndInjectContinue();
  }, 1000);

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

  function checkAndInjectContinue() {
    const buttons = document.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim();
      if (/^Continue$/i.test(txt)) {
        if (!btn.parentElement || btn.parentElement.querySelector('.' + INLINE_BTN_CLASS)) continue;
        injectScheduleNextToContinue(btn);
      }
    }
  }

  function injectScheduleNextToContinue(continueBtn) {
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

    continueBtn.parentElement.insertBefore(scheduleBtn, continueBtn.nextSibling);
    console.log('[MailMerge ContentScript] Injected "Schedule" button next to native "Continue" button.');
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
    const meta = extractDraftMetadata(composeDialog);

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
          '<div style="font-size: 13px; color: #202124; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px;">' +
            escapeHtml(subject || '(No Subject)') +
          '</div>' +
          sheetInfoHtml +
          tagsHtml +
        '</div>' +

        '<div style="margin-bottom: 14px;">' +
          '<label style="display: block; font-size: 11px; font-weight: 600; color: #3c4043; text-transform: uppercase; margin-bottom: 4px;">' +
            'Dispatch Date & Time (Real Time)' +
          '</label>' +
          '<input type="datetime-local" id="mmDateTimeInput" value="' + defaultTimeStr + '" min="' + minTimeStr + '" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 6px; font-size: 13px; outline: none; font-family: inherit;" />' +
        '</div>' +
        '<div style="display: flex; gap: 6px; margin-bottom: 16px;">' +
          '<button type="button" class="mm-quick-time" data-offset="now" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043; font-weight: 600;">Now</button>' +
          '<button type="button" class="mm-quick-time" data-offset="2" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+2m</button>' +
          '<button type="button" class="mm-quick-time" data-offset="5" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+5m</button>' +
          '<button type="button" class="mm-quick-time" data-offset="15" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+15m</button>' +
          '<button type="button" class="mm-quick-time" data-offset="30" style="flex: 1; padding: 4px 6px; font-size: 11px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; color: #3c4043;">+30m</button>' +
        '</div>' +
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

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Verifying draft...';

      try {
        if (!root.IDBStore) {
          throw new Error('IDBStore is not available');
        }

        // 1. Ensure Draft ID is saved & permanent on Google server
        const verifiedDraftId = await ensureDraftSaved(composeDialog);

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
        showToast('✅ Scheduled for ' + new Date(scheduledTime).toLocaleString() + (meta.recipientCount ? ' (' + meta.recipientCount + ' recipients)' : ''));
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
    const countMatch = (composeDialog.textContent || '').match(/(\d+)\s+recipients?\b/i);
    if (countMatch) recipientCount = parseInt(countMatch[1], 10);
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
    });
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
