/**
 * Content Script for Gmail Native Mail Merge & Scheduler
 * Implements "Option A: Detect & Hide" architecture:
 * 1. Detects Gmail Native Mail Merge in real time.
 * 2. When Gmail Native Mail Merge is ACTIVE:
 *    - Completely HIDES the extension panel to eliminate clutter, button confusion, and space-hogging.
 *    - Injects a sleek "📅 Schedule" button adjacent to Gmail's native purple "Continue" button.
 *    - Clicking "📅 Schedule" opens a compact popover allowing users to schedule native dispatches for later.
 * 3. When Gmail Native Mail Merge is INACTIVE:
 *    - Normal compose is 100% clean and unobstructed (panel is hidden by default).
 *    - Bottom toolbar contains "⚡ Mail Merge & Schedule" button for standalone campaign configuration.
 */
(function (root) {
  'use strict';

  console.log('[MailMerge ContentScript] Initializing Gmail Content Script (Option A: Detect & Hide)...');

  const BUTTON_ATTR = 'data-mail-merge-btn-injected';
  const NATIVE_SCHED_ATTR = 'data-native-schedule-btn-injected';
  const PANEL_ID = 'gmail-mail-merge-panel-root';

  /**
   * Discovers all open Gmail compose dialogs in the DOM
   * @returns {Element[]}
   */
  function findComposeDialogs() {
    const dialogs = new Set();
    const composeSelectors = [
      'div[role="dialog"]',
      'div.M9',
      'div[role="region"][aria-label*="Message" i]',
      'div[role="region"][aria-label*="Compose" i]',
      'div.AD',
      'div[data-compose-id]'
    ];

    // 1. Find dialogs wrapping active message bodies
    const bodyElements = document.querySelectorAll('div[aria-label="Message Body"], div[role="textbox"][aria-label*="Body" i]');
    for (const bodyEl of bodyElements) {
      for (const sel of composeSelectors) {
        const dialog = bodyEl.closest(sel);
        if (dialog) {
          dialogs.add(dialog);
          break;
        }
      }
    }

    // 2. Direct query for compose containers
    for (const sel of composeSelectors) {
      const candidates = document.querySelectorAll(sel);
      for (const c of candidates) {
        if (c.querySelector('input[name="subjectbox"]') || c.querySelector('[aria-label="Message Body"]') || c.querySelector('.btC')) {
          dialogs.add(c);
        }
      }
    }

    return Array.from(dialogs);
  }

  /**
   * Detects real-time Gmail native Mail Merge state in the compose dialog
   * @param {Element} composeDialog
   * @returns {{active: boolean, hasContinueBtn: boolean, continueBtn: Element|null, hasBanner: boolean, sheetName: string}}
   */
  function detectGmailNativeStatus(composeDialog) {
    if (!composeDialog) {
      return { active: false, hasContinueBtn: false, continueBtn: null, hasBanner: false, sheetName: '' };
    }

    // 1. Check for Gmail's native purple "Continue" button
    const buttons = composeDialog.querySelectorAll('button, div[role="button"]');
    let continueBtn = null;
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim();
      if (/^Continue$/i.test(txt)) {
        continueBtn = btn;
        break;
      }
    }

    // 2. Check for "You're using mail merge" / "using mail merge" banner text
    const textContent = composeDialog.textContent || '';
    const hasBanner = textContent.includes("You're using mail merge") || textContent.includes("using mail merge");

    // 3. Check for active Mail Merge icon state in "To" field
    const mmIcon = composeDialog.querySelector('span.Sz.brj, [aria-label*="mail merge" i], [data-tooltip*="mail merge" i]');
    let isIconActive = false;
    if (mmIcon) {
      const isPressed = mmIcon.getAttribute('aria-pressed') === 'true';
      const isChecked = mmIcon.getAttribute('aria-checked') === 'true';
      const hasActiveClass = mmIcon.classList.contains('active') || mmIcon.classList.contains('aG');
      isIconActive = isPressed || isChecked || hasActiveClass;
    }

    // 4. Check for attached Google Sheet name in native banner or chips
    let sheetName = '';
    const sheetChips = composeDialog.querySelectorAll('div[role="button"][aria-label*="Spreadsheet" i], div.a9a, div[aria-label*="sheet" i], [data-tooltip*="Spreadsheet" i]');
    for (const chip of sheetChips) {
      const txt = (chip.textContent || '').trim();
      if (txt && !txt.includes('Add from a spreadsheet')) {
        sheetName = txt;
        break;
      }
    }

    const isActive = !!(continueBtn || hasBanner || isIconActive);

    return {
      active: isActive,
      hasContinueBtn: !!continueBtn,
      continueBtn,
      hasBanner,
      sheetName
    };
  }

  /**
   * Checks if native Gmail Mail Merge is enabled for this specific compose dialog
   * @param {Element} composeDialog
   * @returns {boolean}
   */
  function isMailMergeEnabled(composeDialog) {
    return detectGmailNativeStatus(composeDialog).active;
  }

  /**
   * Toggles Gmail's native Mail Merge mode via its native toolbar icon/menu
   * @param {Element} composeDialog
   */
  async function toggleGmailNativeMailMerge(composeDialog) {
    const mmIcon = composeDialog.querySelector('span.Sz.brj, [aria-label*="mail merge" i], [data-tooltip*="mail merge" i]');
    if (mmIcon) {
      console.log('[MailMerge ContentScript] Clicking Gmail native mail merge icon...');
      mmIcon.click();
      await new Promise((r) => setTimeout(r, 250));

      // If Gmail opens a dropdown menu with a checkbox, toggle it
      const menu = document.querySelector('div[role="menu"]:has([role="checkbox"]), div[role="menu"]:has([role="menuitemcheckbox"])');
      if (menu) {
        const checkbox = menu.querySelector('[role="checkbox"], [role="menuitemcheckbox"]');
        if (checkbox && checkbox.getAttribute('aria-checked') !== 'true') {
          checkbox.click();
        }
      }
    }
  }

  /**
   * Synchronizes button injection, Option A panel hiding, and native scheduler controls
   * @param {Element} composeDialog
   */
  function syncComposeDialog(composeDialog) {
    if (!composeDialog) return;

    // 1. Ensure the Mail Merge & Scheduling panel is mounted into this compose dialog (hidden by default)
    let existingPanel = composeDialog.querySelector(`#${PANEL_ID}`);
    if (!existingPanel && root.ComposeInjector && typeof root.ComposeInjector.injectIntoCompose === 'function') {
      root.ComposeInjector.injectIntoCompose(composeDialog);
      existingPanel = composeDialog.querySelector(`#${PANEL_ID}`);
    }

    // 2. Real-time Native Status Detection
    const nativeStatus = detectGmailNativeStatus(composeDialog);

    // 3. Locate toolbar container to place buttons
    const actionContainer =
      composeDialog.querySelector('.aDh') ||
      composeDialog.querySelector('[role="toolbar"]') ||
      composeDialog.querySelector('td.gU.Up') ||
      composeDialog.querySelector('.btC') ||
      composeDialog.querySelector('tr.btC');

    if (!actionContainer) return;

    let mmButton = composeDialog.querySelector(`[${BUTTON_ATTR}="true"]`);
    let nativeSchedBtn = composeDialog.querySelector(`[${NATIVE_SCHED_ATTR}="true"]`);

    // =========================================================================
    // OPTION A: DETECT & HIDE WHEN GMAIL NATIVE MAIL MERGE IS ACTIVE
    // =========================================================================
    if (nativeStatus.active) {
      // 1. Hide extension panel root and table row completely (Option A)
      if (existingPanel) {
        existingPanel.style.display = 'none';
      }
      const panelTr = composeDialog.querySelector('#gmail-mail-merge-panel-tr');
      if (panelTr) {
        panelTr.style.display = 'none';
      }
      if (root.ComposeInjector && typeof root.ComposeInjector.adjustDimensions === 'function') {
        root.ComposeInjector.adjustDimensions(composeDialog, false);
      }

      // 2. Hide standalone "Mail Merge & Schedule" button to prevent duplicate UI
      if (mmButton) {
        mmButton.style.display = 'none';
      }

      // 3. Inject sleek "📅 Schedule" button next to Gmail's purple "Continue" button
      if (!nativeSchedBtn) {
        nativeSchedBtn = document.createElement('button');
        nativeSchedBtn.type = 'button';
        nativeSchedBtn.setAttribute(NATIVE_SCHED_ATTR, 'true');
        nativeSchedBtn.setAttribute('data-tooltip', 'Schedule this native mail merge for later');
        nativeSchedBtn.title = 'Schedule this native mail merge for later';
        nativeSchedBtn.innerHTML = `
          <span style="font-size: 13px; margin-right: 4px; display: inline-block;">📅</span>
          <span style="font-weight: 600;">Schedule</span>
        `;
        nativeSchedBtn.style.cssText = `
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 36px;
          padding: 0 13px;
          margin-left: 6px;
          margin-right: 6px;
          background: #fbf8ff;
          color: #7e22ce;
          border: 1px solid #c084fc;
          border-radius: 18px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          user-select: none;
          vertical-align: middle;
          box-shadow: 0 1px 2px rgba(126, 34, 206, 0.15);
          transition: all 0.15s ease;
          z-index: 10;
        `;

        nativeSchedBtn.addEventListener('mouseenter', () => {
          nativeSchedBtn.style.background = '#f3e8fd';
          nativeSchedBtn.style.borderColor = '#7e22ce';
        });

        nativeSchedBtn.addEventListener('mouseleave', () => {
          nativeSchedBtn.style.background = '#fbf8ff';
          nativeSchedBtn.style.borderColor = '#c084fc';
        });

        // Click opens compact schedule popover
        nativeSchedBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleNativeSchedulePopover(composeDialog, nativeSchedBtn);
        });

        // Place adjacent to native Continue button
        const targetBtn = nativeStatus.continueBtn || actionContainer.firstElementChild;
        const targetParent = targetBtn?.parentElement || actionContainer;
        if (targetBtn && targetParent && targetParent.tagName !== 'TR') {
          targetParent.insertBefore(nativeSchedBtn, targetBtn.nextSibling);
        } else if (actionContainer.tagName !== 'TR') {
          actionContainer.appendChild(nativeSchedBtn);
        } else {
          const td = actionContainer.querySelector('td') || actionContainer;
          td.appendChild(nativeSchedBtn);
        }
      } else {
        nativeSchedBtn.style.display = 'inline-flex';
      }

    } else {
      // =========================================================================
      // GMAIL NATIVE MERGE IS NOT ACTIVE (STANDARD COMPOSE MODE)
      // =========================================================================

      // 1. Hide native schedule button and remove open popovers
      if (nativeSchedBtn) {
        nativeSchedBtn.style.display = 'none';
      }
      closeNativeSchedulePopover(composeDialog);

      // 2. Ensure standard "⚡ Mail Merge & Schedule" button is present
      if (!mmButton) {
        mmButton = document.createElement('button');
        mmButton.type = 'button';
        mmButton.setAttribute(BUTTON_ATTR, 'true');

        mmButton.style.cssText = `
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 36px;
          padding: 0 13px;
          margin-left: 8px;
          margin-right: 8px;
          border-radius: 18px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          user-select: none;
          vertical-align: middle;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          z-index: 10;
        `;

        // Click toggles standalone companion panel
        mmButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (root.ComposeInjector && typeof root.ComposeInjector.togglePanel === 'function') {
            root.ComposeInjector.togglePanel(composeDialog);
          }
        });

        const sendBtn =
          composeDialog.querySelector('div[role="button"][data-tooltip*="Send" i]') ||
          composeDialog.querySelector('div[role="button"][aria-label*="Send" i]') ||
          composeDialog.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3') ||
          composeDialog.querySelector('.T-I.J-J5-Ji.aoO') ||
          actionContainer.firstElementChild;

        const targetParent = sendBtn?.parentElement || actionContainer;
        if (sendBtn && targetParent && targetParent.tagName !== 'TR') {
          targetParent.insertBefore(mmButton, sendBtn.nextSibling);
        } else if (actionContainer.tagName !== 'TR') {
          actionContainer.appendChild(mmButton);
        } else {
          const td = actionContainer.querySelector('td') || actionContainer;
          td.appendChild(mmButton);
        }
      }

      mmButton.style.display = 'inline-flex';
      mmButton.innerHTML = `
        <span style="font-size: 13px; margin-right: 5px;">⚡</span>
        <span style="font-weight: 600; letter-spacing: 0.1px;">Mail Merge & Schedule</span>
      `;
      mmButton.setAttribute('data-tooltip', 'Open Mail Merge & Scheduling Companion');
      mmButton.title = 'Open Mail Merge & Scheduling Companion';

      const isPanelOpen = root.ComposeInjector && root.ComposeInjector.isPanelOpen(composeDialog);
      if (isPanelOpen) {
        mmButton.style.background = '#1a73e8';
        mmButton.style.color = '#ffffff';
        mmButton.style.border = '1px solid #1557b0';
        mmButton.style.boxShadow = '0 1px 4px rgba(26, 115, 232, 0.3)';
      } else {
        mmButton.style.background = '#e8f0fe';
        mmButton.style.color = '#1a73e8';
        mmButton.style.border = '1px solid #dadce0';
        mmButton.style.boxShadow = '0 1px 2px rgba(60, 64, 67, 0.1)';
      }
    }
  }

  /**
   * Toggles the compact, non-intrusive floating schedule popover above the native Schedule button
   * @param {Element} composeDialog
   * @param {Element} anchorBtn
   */
  function toggleNativeSchedulePopover(composeDialog, anchorBtn) {
    const existingPopover = composeDialog.querySelector('.gmail-native-schedule-popover');
    if (existingPopover) {
      existingPopover.remove();
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'gmail-native-schedule-popover';
    popover.style.cssText = `
      position: absolute;
      bottom: 46px;
      left: 0;
      width: 285px;
      background: #ffffff;
      border: 1px solid #d8b4fe;
      border-radius: 8px;
      box-shadow: 0 4px 18px rgba(126, 34, 206, 0.22);
      padding: 12px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #202124;
      text-align: left;
    `;

    // Default: 10 minutes from now
    const defaultFuture = new Date(Date.now() + 10 * 60 * 1000);
    defaultFuture.setMinutes(defaultFuture.getMinutes() - defaultFuture.getTimezoneOffset());
    const defaultTimeStr = defaultFuture.toISOString().slice(0, 16);
    const minTimeStr = new Date().toISOString().slice(0, 16);

    popover.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="font-size: 12px; color: #7e22ce; display: flex; align-items: center; gap: 5px;">
          <span>📅</span> Schedule Native Mail Merge
        </strong>
        <span class="popover-close-btn" style="cursor: pointer; font-size: 14px; color: #5f6368; padding: 0 4px; line-height: 1;">✕</span>
      </div>
      <div style="font-size: 11px; color: #5f6368; margin-bottom: 8px; line-height: 1.35;">
        Gmail will automatically dispatch via its native engine to your linked recipients at this scheduled time.
      </div>
      <div style="margin-bottom: 8px;">
        <label style="font-size: 10px; font-weight: 600; color: #5f6368; text-transform: uppercase; display: block; margin-bottom: 3px;">Dispatch Time</label>
        <input type="datetime-local" class="popover-date-input" value="${defaultTimeStr}" min="${minTimeStr}" style="width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px; outline: none;" />
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #3c4043; cursor: pointer; user-select: none;">
          <input type="checkbox" class="popover-dryrun-chk" checked />
          <span style="color: #137333; font-weight: 500;">🛡️ Safe Preview / Dry Run</span>
        </label>
      </div>
      <div id="popoverAlert" style="display: none; font-size: 11px; padding: 4px 8px; border-radius: 4px; margin-bottom: 8px;"></div>
      <div style="display: flex; justify-content: flex-end; gap: 6px;">
        <button type="button" class="popover-cancel-btn" style="background: transparent; border: 1px solid #dadce0; border-radius: 4px; padding: 4px 10px; font-size: 11px; cursor: pointer; color: #5f6368;">Cancel</button>
        <button type="button" class="popover-queue-btn" style="background: #7e22ce; color: #ffffff; border: none; border-radius: 4px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer;">Queue Schedule</button>
      </div>
    `;

    // Anchor relative to parent
    if (anchorBtn.parentElement) {
      anchorBtn.parentElement.style.position = 'relative';
      anchorBtn.parentElement.appendChild(popover);
    } else {
      composeDialog.appendChild(popover);
    }

    popover.querySelector('.popover-close-btn').addEventListener('click', () => popover.remove());
    popover.querySelector('.popover-cancel-btn').addEventListener('click', () => popover.remove());

    const queueBtn = popover.querySelector('.popover-queue-btn');
    const dateInput = popover.querySelector('.popover-date-input');
    const dryRunChk = popover.querySelector('.popover-dryrun-chk');
    const alertEl = popover.querySelector('#popoverAlert');

    queueBtn.addEventListener('click', async () => {
      const val = dateInput.value;
      if (!val) {
        alertEl.textContent = 'Please choose a date and time.';
        alertEl.style.display = 'block';
        alertEl.style.background = '#fce8e6';
        alertEl.style.color = '#c5221f';
        return;
      }

      const scheduledTime = new Date(val).getTime();
      if (isNaN(scheduledTime) || scheduledTime <= Date.now()) {
        alertEl.textContent = 'Scheduled time must be in the future.';
        alertEl.style.display = 'block';
        alertEl.style.background = '#fce8e6';
        alertEl.style.color = '#c5221f';
        return;
      }

      const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
      const bodyEditor = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"]');
      const currentSubject = subjectInput ? subjectInput.value.trim() : '';
      const currentBody = bodyEditor ? (bodyEditor.innerText || bodyEditor.textContent || '').trim() : '';

      const nativeStatus = detectGmailNativeStatus(composeDialog);
      const sheetName = nativeStatus.sheetName || 'Gmail Native Linked Sheet';

      queueBtn.disabled = true;
      queueBtn.textContent = 'Scheduling...';

      try {
        if (!root.IDBStore) {
          throw new Error('IDBStore is not available');
        }

        const campaign = {
          name: currentSubject ? currentSubject.slice(0, 50) : `Native Mail Merge (${new Date(scheduledTime).toLocaleDateString()})`,
          spreadsheetUrl: `[Gmail Native Sheet: ${sheetName}]`,
          subject: currentSubject,
          bodyTemplate: currentBody,
          recipientColumn: 'native',
          includeUnsubscribe: true,
          dryRun: dryRunChk.checked,
          isNative: true,
          scheduledAt: new Date(scheduledTime).toISOString(),
          status: 'QUEUED'
        };

        const saved = await root.IDBStore.saveCampaign(campaign);
        await root.IDBStore.addLog(saved.id, 'INFO', `Native Gmail Mail Merge scheduled for ${new Date(scheduledTime).toLocaleString()}`);

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({
            action: 'REGISTER_SCHEDULED_ALARM',
            campaignId: saved.id,
            scheduledTime: scheduledTime
          }).catch(() => {});
        }

        alertEl.textContent = `✓ Scheduled for ${new Date(scheduledTime).toLocaleTimeString()}!`;
        alertEl.style.display = 'block';
        alertEl.style.background = '#e6f4ea';
        alertEl.style.color = '#137333';

        setTimeout(() => {
          popover.remove();
        }, 1500);
      } catch (err) {
        alertEl.textContent = `Error: ${err.message}`;
        alertEl.style.display = 'block';
        alertEl.style.background = '#fce8e6';
        alertEl.style.color = '#c5221f';
        queueBtn.disabled = false;
        queueBtn.textContent = 'Queue Schedule';
      }
    });
  }

  function closeNativeSchedulePopover(composeDialog) {
    const p = composeDialog?.querySelector('.gmail-native-schedule-popover');
    if (p) p.remove();
  }

  /**
   * Scans and syncs all open compose dialogs
   */
  function scanAndSync() {
    const dialogs = findComposeDialogs();
    for (const dialog of dialogs) {
      try {
        syncComposeDialog(dialog);
      } catch (err) {
        console.warn('[MailMerge ContentScript] Error syncing compose dialog:', err);
      }
    }
  }

  // =========================================================================
  // MUTATION OBSERVER (Responsive SPA Watcher)
  // =========================================================================

  let observerTimeout = null;

  const observer = new MutationObserver((mutations) => {
    let hasRelevantMutation = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        hasRelevantMutation = true;
        break;
      }
      if (mutation.type === 'attributes' && (mutation.attributeName === 'class' || mutation.attributeName === 'aria-checked' || mutation.attributeName === 'aria-pressed')) {
        hasRelevantMutation = true;
        break;
      }
    }

    if (hasRelevantMutation) {
      if (observerTimeout) clearTimeout(observerTimeout);
      observerTimeout = setTimeout(() => {
        scanAndSync();
      }, 150);
    }
  });

  // Start observing document body
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-checked', 'aria-pressed']
    });
    scanAndSync();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-checked', 'aria-pressed']
      });
      scanAndSync();
    });
  }

  // Dismiss schedule popover on external click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.gmail-native-schedule-popover') && !e.target.closest(`[${NATIVE_SCHED_ATTR}="true"]`)) {
      document.querySelectorAll('.gmail-native-schedule-popover').forEach((p) => p.remove());
    }
  });

  // =========================================================================
  // RUNTIME MESSAGE LISTENER (Service Worker Communication)
  // =========================================================================

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      console.log(`[MailMerge ContentScript] Message received: ${message.action}`);

      if (message.action === 'PING') {
        sendResponse({ success: true, ready: true, url: window.location.href });
        return true;
      }

      if (message.action === 'EXECUTE_CAMPAIGN') {
        const campaign = message.campaign;
        console.log(`[MailMerge ContentScript] Dispatched EXECUTE_CAMPAIGN for "${campaign?.subject || campaign?.id}"`);

        if (!root.GmailAutomator || typeof root.GmailAutomator.runMailMerge !== 'function') {
          console.error('[MailMerge ContentScript] GmailAutomator is missing.');
          sendResponse({ success: false, error: 'GmailAutomator is not available in content script.' });
          return false;
        }

        // Acknowledge immediately to background service worker
        sendResponse({ success: true, accepted: true, starting: true });

        // Execute asynchronous mail merge automation
        root.GmailAutomator.runMailMerge(campaign, (prog) => {
          console.log(`[MailMerge ContentScript] [Campaign ${campaign?.id}] ${prog.pct}% - ${prog.step}: ${prog.message}`);
        })
          .then((result) => {
            console.log('[MailMerge ContentScript] Automation finished:', result);
          })
          .catch((err) => {
            console.error('[MailMerge ContentScript] Automation error:', err);
          });

        return false;
      }
    });
  }

  // Expose helpers globally
  root.MailMergeNative = {
    detectGmailNativeStatus,
    isMailMergeEnabled,
    toggleGmailNativeMailMerge
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
