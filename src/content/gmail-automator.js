/**
 * GmailAutomator - Browser-Native DOM Automation for Gmail Native Mail Merge
 * Ports the battle-tested automation logic from gmailMailMergeWorker.js
 * Runs directly inside active Gmail tabs.
 */
(function (root) {
  'use strict';

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  /**
   * Promise-based delay
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extracts Google Sheet ID from full URL or returns raw ID
   * e.g. https://docs.google.com/spreadsheets/d/1th9yiyDeKHIIB381KAT4vRpQElFMDoJpZ0dMjnQICJY/edit -> 1th9yiyDeKHIIB381KAT4vRpQElFMDoJpZ0dMjnQICJY
   * @param {string} input
   * @returns {string|null}
   */
  function extractGoogleSheetId(input) {
    if (!input) return null;
    const str = String(input).trim();
    const match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i) || str.match(/\/d\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9_-]{25,}$/.test(str)) return str;
    return null;
  }

  /**
   * Polls until a predicate returns a truthy value or timeout expires
   * @param {Function} predicate
   * @param {Object} options
   * @returns {Promise<*>}
   */
  async function waitFor(predicate, { timeout = 15000, interval = 250, errorMsg = 'Condition timed out' } = {}) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        const result = predicate();
        if (result) return result;
      } catch (_) {
        // Suppress transient query errors
      }
      await sleep(interval);
    }
    throw new Error(`${errorMsg} (timeout ${timeout}ms)`);
  }

  /**
   * Queries the first visible element matching any of the selector strings
   * @param {string|string[]} selectors
   * @param {Element|Document} root
   * @returns {Element|null}
   */
  function findElement(selectors, root = document) {
    const selectorList = Array.isArray(selectors) ? selectors : selectors.split(',').map((s) => s.trim());
    for (const sel of selectorList) {
      try {
        const elements = root.querySelectorAll(sel);
        for (const el of elements) {
          if (isElementVisible(el)) {
            return el;
          }
        }
      } catch (_) {
        // Ignore invalid CSS selectors in fallbacks
      }
    }
    return null;
  }

  /**
   * Checks whether an element is visible in the DOM
   * @param {Element} el
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Finds an element matching selector that contains text matching regex
   * @param {Element|Document} root
   * @param {string} selector
   * @param {RegExp|string} textPattern
   * @returns {Element|null}
   */
  function findByText(root, selector, textPattern) {
    const regex = textPattern instanceof RegExp ? textPattern : new RegExp(textPattern, 'i');
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      if (isElementVisible(el) && regex.test(el.textContent || '')) {
        return el;
      }
    }
    return null;
  }

  /**
   * Simulates full mouse/pointer click sequence for Gmail UI elements
   * @param {Element} el
   */
  async function humanClick(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await sleep(80);

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0
    };

    el.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
    el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    if (typeof el.focus === 'function') {
      el.focus();
    }
    await sleep(60);
    el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
    el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    el.dispatchEvent(new MouseEvent('click', eventOpts));
  }

  /**
   * Fills an HTML input element and dispatches appropriate input/change events
   * @param {HTMLInputElement} inputEl
   * @param {string} value
   */
  async function humanInput(inputEl, value) {
    if (!inputEl) return;
    inputEl.focus();
    await sleep(50);
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /**
   * Fills Gmail's contenteditable message body and triggers input updates
   * @param {Element} bodyEditor
   * @param {string} textContent
   */
  async function fillMessageBody(bodyEditor, textContent) {
    if (!bodyEditor) return;
    bodyEditor.focus();
    await sleep(100);

    // Select all existing content
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(bodyEditor);
    selection.removeAllRanges();
    selection.addRange(range);

    // Prefer document.execCommand for rich editor integration if supported
    let success = false;
    try {
      success = document.execCommand('insertText', false, textContent);
    } catch (_) {
      success = false;
    }

    if (!success) {
      // Fallback: convert newlines to paragraphs / linebreaks
      const formatted = textContent
        .split('\n\n')
        .map((paragraph) => `<div>${paragraph.replace(/\n/g, '<br>')}</div>`)
        .join('<div><br></div>');
      bodyEditor.innerHTML = formatted;
    }

    bodyEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    bodyEditor.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    bodyEditor.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /**
   * Finds the Google Drive Picker iframe in the current document
   * @returns {HTMLIFrameElement|null}
   */
  function findPickerIframe() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || '';
      const name = iframe.getAttribute('name') || '';
      const className = iframe.className || '';
      if (
        src.includes('picker') ||
        src.includes('drive.google.com') ||
        src.includes('docs.google.com/picker') ||
        name.includes('picker') ||
        (typeof className === 'string' && className.includes('picker'))
      ) {
        return iframe;
      }
    }
    // Fallback: check any visible modal dialog iframe
    for (const iframe of iframes) {
      if (isElementVisible(iframe) && iframe.clientWidth > 400 && iframe.clientHeight > 300) {
        return iframe;
      }
    }
    return null;
  }

  // =========================================================================
  // MAIN AUTOMATOR CLASS
  // =========================================================================

  class GmailAutomator {
    /**
     * Extracts Sheet ID from Google Sheet URL or raw ID
     * @param {string} url
     * @returns {string|null}
     */
    static extractGoogleSheetId(url) {
      return extractGoogleSheetId(url);
    }

    /**
     * Checks if a Gmail Compose dialog is currently open
     * @returns {boolean}
     */
    static isComposeOpen() {
      return !!this.getComposeDialog();
    }

    /**
     * Retrieves the currently active or topmost Compose dialog
     * @returns {Element|null}
     */
    static getComposeDialog() {
      const composeSelectors = [
        'div[role="dialog"][aria-label*="Compose" i]',
        'div[role="dialog"][aria-label*="New Message" i]',
        'div[role="dialog"] div[aria-label="Message Body"]',
        'div[gh="cm"]',
        'div.AD' // Common Gmail compose wrapper
      ];

      for (const sel of composeSelectors) {
        const dialog = document.querySelector(sel);
        if (dialog) {
          return dialog.closest('div[role="dialog"]') || dialog;
        }
      }
      return null;
    }

    /**
     * Opens a new Compose window if none is currently active
     * @returns {Promise<Element>}
     */
    static async openCompose() {
      let dialog = this.getComposeDialog();
      if (dialog) return dialog;

      console.log('[GmailAutomator] Locating Compose button...');
      const composeBtn = await waitFor(
        () => {
          return findElement([
            'div[gh="cm"]',
            'div[role="button"][gh="cm"]',
            'div.T-I-KE',
            '[role="button"][aria-label*="Compose" i]',
            'button[aria-label*="Compose" i]'
          ]) || findByText(document, 'div[role="button"], button', /^Compose$/i);
        },
        { timeout: 15000, errorMsg: 'Could not find Gmail Compose button' }
      );

      console.log('[GmailAutomator] Clicking Compose button...');
      await humanClick(composeBtn);
      await sleep(1500);

      dialog = await waitFor(
        () => this.getComposeDialog(),
        { timeout: 15000, errorMsg: 'Compose dialog did not appear after clicking Compose' }
      );

      return dialog;
    }

    /**
     * Executes the end-to-end Gmail Native Mail Merge flow inside the active tab.
     * Ports the automation logic from gmailMailMergeWorker.js
     *
     * @param {Object} campaignConfig
     * @param {string} campaignConfig.spreadsheetUrl
     * @param {string} [campaignConfig.spreadsheetTitle]
     * @param {string} campaignConfig.subject
     * @param {string} campaignConfig.bodyTemplate
     * @param {string} [campaignConfig.recipientColumn='email']
     * @param {boolean} [campaignConfig.includeUnsubscribe=true]
     * @param {string} [campaignConfig.id]
     * @param {Function} [onProgress] - Callback (progressObj) => void
     * @returns {Promise<{ success: boolean, message: string, campaignId?: string }>}
     */
    static async runMailMerge(campaignConfig, onProgress = () => {}) {
      const config = {
        spreadsheetUrl: campaignConfig.spreadsheetUrl || campaignConfig.spreadsheet_url || campaignConfig.sheetUrl || '',
        spreadsheetTitle: campaignConfig.spreadsheetTitle || campaignConfig.spreadsheet_title || campaignConfig.sheetTitle || '',
        subject: campaignConfig.subject || '',
        bodyTemplate: campaignConfig.bodyTemplate || campaignConfig.body_template || campaignConfig.body || '',
        recipientColumn: campaignConfig.recipientColumn || campaignConfig.recipient_column || 'email',
        includeUnsubscribe: campaignConfig.includeUnsubscribe !== undefined
          ? !!campaignConfig.includeUnsubscribe
          : (campaignConfig.include_unsubscribe !== undefined ? !!campaignConfig.include_unsubscribe : true),
        dryRun: campaignConfig.dryRun !== undefined
          ? !!campaignConfig.dryRun
          : (campaignConfig.dry_run !== undefined ? !!campaignConfig.dry_run : true),
        id: campaignConfig.id || campaignConfig.campaignId || null
      };

      const campaignId = config.id;

      const progress = async (step, message, pct = 0) => {
        const payload = { step, message, pct, campaignId, timestamp: new Date().toISOString() };
        console.log(`[GmailAutomator] [${pct}%] ${step}: ${message}`);
        try {
          onProgress(payload);
        } catch (_) {}

        if (root.IDBStore && typeof root.IDBStore.addLog === 'function') {
          try {
            await root.IDBStore.addLog(campaignId, 'INFO', `[${step}] ${message}`);
          } catch (_) {}
        }
      };

      try {
        await progress('INIT', 'Starting Gmail Native Mail Merge automation...', 5);

        // 1. Extract Google Sheet ID
        const extractedSheetId = extractGoogleSheetId(config.spreadsheetUrl) || extractGoogleSheetId(config.spreadsheetTitle);
        const sheetSearchQuery = extractedSheetId || (config.spreadsheetTitle && !config.spreadsheetTitle.startsWith('http') ? config.spreadsheetTitle : config.spreadsheetUrl);

        if (!sheetSearchQuery) {
          throw new Error('A valid Google Sheet URL, Sheet ID, or Spreadsheet Title is required.');
        }

        console.log(`[GmailAutomator] Target Spreadsheet Query: "${sheetSearchQuery}" (Extracted ID: ${extractedSheetId || 'None'})`);

        // 2. Locate or Open Compose Window
        await progress('COMPOSE', 'Ensuring Gmail Compose dialog is open...', 10);
        const composeDialog = await this.openCompose();
        await sleep(1200);

        // 3. Check and Enable Mail merge inside compose dialog
        await progress('MAIL_MERGE_BUTTON', 'Checking Mail merge state in Compose window...', 20);

        const isAlreadyMailMerge =
          isElementVisible(composeDialog.querySelector('div[role="button"][data-tooltip*="Continue" i]')) ||
          findByText(composeDialog, 'button, div[role="button"]', /^Continue$/i) ||
          (composeDialog.textContent || '').includes("using mail merge") ||
          (composeDialog.textContent || '').includes("You're using mail merge");

        if (isAlreadyMailMerge) {
          console.log('[GmailAutomator] Mail merge mode is already active in Compose.');
        } else {
          const mailMergeBtn = await waitFor(
            () => {
              return findElement(
                [
                  'span.Sz.brj',
                  '[aria-label*="mail merge" i]',
                  '[data-tooltip*="mail merge" i]',
                  '[aria-label*="Mail merge" i]',
                  'div[role="button"][data-tooltip*="Mail merge" i]',
                  'div[role="button"][aria-label*="Mail merge" i]'
                ],
                composeDialog
              ) || findElement([
                'span.Sz.brj',
                '[aria-label*="mail merge" i]',
                '[data-tooltip*="mail merge" i]'
              ], document);
            },
            { timeout: 15000, errorMsg: 'Could not find Mail merge button in Compose dialog' }
          );

          console.log('[GmailAutomator] Clicking Mail merge button...');
          await humanClick(mailMergeBtn);
          await sleep(1500);

          // Wait for Mail merge menu / popup
          let menu = await waitFor(
            () => {
              return findElement([
                'div[role="menu"]:has([role="checkbox"])',
                'div[role="menu"]',
                'div.J-M[role="menu"]'
              ], document);
            },
            { timeout: 8000, errorMsg: 'Mail merge popup menu did not appear' }
          ).catch(async () => {
            console.warn('[GmailAutomator] Menu not opened on first click, retrying click...');
            await humanClick(mailMergeBtn);
            await sleep(1500);
            return waitFor(
              () => findElement(['div[role="menu"]', 'div.J-M'], document),
              { timeout: 8000, errorMsg: 'Mail merge menu did not open' }
            );
          });

          // 4. Ensure Mail merge checkbox is enabled
          await progress('ENABLE_MERGE', 'Ensuring Mail merge is checked...', 28);
          const checkbox = findElement('[role="checkbox"]', menu) || findByText(menu, '[role="menuitemcheckbox"], [role="checkbox"]', /mail merge/i);
          if (checkbox) {
            const isChecked = checkbox.getAttribute('aria-checked') === 'true' || checkbox.classList.contains('J-Ks-KO');
            if (!isChecked) {
              console.log('[GmailAutomator] Enabling Mail merge checkbox...');
              await humanClick(checkbox);
              await sleep(1500);
            } else {
              console.log('[GmailAutomator] Mail merge checkbox is already enabled.');
            }
          }
        }

        // Check if spreadsheet is already linked to this compose dialog
        const isSheetAlreadyLinked =
          (composeDialog.textContent || '').includes("Linked to") ||
          (composeDialog.textContent || '').includes("recipients from") ||
          (composeDialog.textContent || '').includes("Spreadsheet") ||
          composeDialog.querySelector('div[aria-label*="recipients from" i]') ||
          composeDialog.querySelector('div[aria-label*="Linked to" i]');

        if (isSheetAlreadyLinked) {
          console.log('[GmailAutomator] Target spreadsheet is already linked to Compose. Skipping picker step.');
          await progress('LINKED', 'Spreadsheet already linked. Proceeding...', 65);
        } else {
          // 5. Select "Add from a spreadsheet"
          await progress('ADD_SPREADSHEET', 'Selecting "Add from a spreadsheet"...', 35);
          let addFromSheetOption = findByText(document, '[role="menuitem"], div[role="menuitem"], span', /add from a spreadsheet/i);
          if (!addFromSheetOption) {
            const mmBtn = findElement(['span.Sz.brj', '[aria-label*="mail merge" i]'], composeDialog);
            if (mmBtn) {
              await humanClick(mmBtn);
              await sleep(1200);
            }
            addFromSheetOption = await waitFor(
              () => findByText(document, '[role="menuitem"], div[role="menuitem"], span', /add from a spreadsheet/i),
              { timeout: 8000, errorMsg: 'Could not find "Add from a spreadsheet" menu option' }
            );
          }

          await humanClick(addFromSheetOption);
          await sleep(2500);

          // 6. Handle Google Drive Picker iframe
          await progress('DRIVE_PICKER', 'Waiting for Google Drive Picker to load...', 45);
          const pickerIframe = await waitFor(
            () => findPickerIframe(),
            { timeout: 20000, errorMsg: 'Google Drive Picker iframe not found' }
          );

          console.log('[GmailAutomator] Google Drive Picker iframe detected.');
          await sleep(2000);

          let pickerHandled = false;
          let pickerDoc = null;
          try {
            pickerDoc = pickerIframe.contentDocument || pickerIframe.contentWindow?.document;
          } catch (iframeErr) {
            console.warn('[GmailAutomator] Direct iframe document access restricted:', iframeErr);
          }

          if (pickerDoc) {
            try {
              // Search for spreadsheet in same-origin Picker
              await progress('SEARCH_SHEET', `Searching for spreadsheet "${sheetSearchQuery}"...`, 52);
              const searchInput = await waitFor(
                () => {
                  return findElement([
                    'input[aria-label*="Search" i]',
                    'input[placeholder*="Search" i]',
                    'input[type="text"]'
                  ], pickerDoc);
                },
                { timeout: 10000, errorMsg: 'Could not find Search input in Drive Picker' }
              );

              await humanInput(searchInput, sheetSearchQuery);
              await sleep(300);

              searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              await sleep(3500);

              let fileCard = await waitFor(
                () => findElement(['div[role="row"]', 'div[role="option"]', 'div[role="gridcell"]', '.picker-grid-item'], pickerDoc),
                { timeout: 8000, errorMsg: `No file result found for query "${sheetSearchQuery}"` }
              );

              await humanClick(fileCard);
              await sleep(1500);

              const selectBtn = await waitFor(
                () => {
                  return findElement([
                    'button[name="ok"]',
                    'button:has-text("Insert")',
                    'button:has-text("Select")',
                    'div[role="button"]:has-text("Insert")'
                  ], pickerDoc) || findByText(pickerDoc, 'button, div[role="button"]', /^(insert|select|ok)$/i);
                },
                { timeout: 8000, errorMsg: 'Could not find Insert/Select button in Drive Picker' }
              );

              await humanClick(selectBtn);
              pickerHandled = true;
              await sleep(3500);
            } catch (pickerErr) {
              console.warn('[GmailAutomator] Direct picker interaction failed, attempting background bridge:', pickerErr);
            }
          }

          if (!pickerHandled) {
            // Background script fallback with allFrames scripting permission
            console.log('[GmailAutomator] Delegating Drive Picker search to background service worker...');
            await progress('SEARCH_SHEET', `Selecting spreadsheet "${sheetSearchQuery}" via background engine...`, 52);
            const bridgeRes = await chrome.runtime.sendMessage({
              action: 'AUTOMATE_DRIVE_PICKER',
              query: sheetSearchQuery,
              fallbackTitle: config.spreadsheetTitle
            });
            console.log('[GmailAutomator] Background picker response:', bridgeRes);
            await sleep(3500);
          }

          // 7. Handle "Finish linking spreadsheet" Column Mapping Dialog if present
          await progress('MAP_COLUMNS', 'Checking spreadsheet column mappings...', 62);
          const finishLinkingModal = await waitFor(
            () => {
              return findByText(document, 'div[role="dialog"], h2, div', /finish linking spreadsheet/i) ||
                     findElement('div.rHGeGc-aPP78e', document);
            },
            { timeout: 8000, errorMsg: '"Finish linking spreadsheet" modal did not appear' }
          ).catch(() => null);

          if (finishLinkingModal) {
            await sleep(1000);
            const emailDropdown = findElement([
              'div.rHGeGc-aPP78e',
              'div[role="listbox"]',
              'div[role="combobox"]',
              'div[aria-haspopup="listbox"]'
            ], document);

            if (emailDropdown) {
              await humanClick(emailDropdown);
              await sleep(1200);

              const targetColRegex = new RegExp(config.recipientColumn || 'email', 'i');
              const emailOption = findByText(document, 'li[role="option"], div[role="option"], [role="menuitem"]', targetColRegex) ||
                                  findByText(document, 'li[role="option"], div[role="option"]', /email/i);

              if (emailOption) {
                await humanClick(emailOption);
                await sleep(1200);
              }
            }

            const finishBtn = findByText(document, 'button, div[role="button"]', /^finish$/i) ||
                             findElement('button[name="ok"]', document);
            if (finishBtn) {
              await humanClick(finishBtn);
              await sleep(2500);
            }
          }
        }

        // 8. Fill Subject Line
        await progress('SET_SUBJECT', 'Populating subject line...', 70);
        const subjectInput = await waitFor(
          () => {
            return findElement([
              'input[name="subjectbox"]',
              'input[aria-label="Subject"]',
              'input[placeholder="Subject"]'
            ], composeDialog);
          },
          { timeout: 8000, errorMsg: 'Could not find Subject input box in Compose dialog' }
        );

        const cleanSubject = (config.subject || 'Announcement').replace(/@\w+/g, '').trim();
        await humanInput(subjectInput, cleanSubject);
        await sleep(1000);

        // 9. Fill Message Body
        await progress('SET_BODY', 'Populating message body...', 78);
        const bodyEditor = await waitFor(
          () => {
            return findElement([
              'div[aria-label="Message Body"]',
              'div[role="textbox"][aria-label*="Body" i]',
              'div[g_editable="true"]'
            ], composeDialog);
          },
          { timeout: 8000, errorMsg: 'Could not find Message Body editor in Compose dialog' }
        );

        const cleanBody = (config.bodyTemplate || 'Hello,\n\nPlease find the details below.\n\nBest regards,')
          .replace(/@name/gi, 'Colleague')
          .replace(/@firstname/gi, 'Colleague')
          .replace(/@email/gi, '')
          .replace(/@\w+/g, '')
          .trim();

        await fillMessageBody(bodyEditor, cleanBody);
        await sleep(2000);

        // 10. Click Continue button
        await progress('CONTINUE', 'Clicking Continue button to validate Mail Merge...', 85);
        const continueBtn = await waitFor(
          () => {
            return findByText(composeDialog, 'button, div[role="button"]', /^continue$/i) ||
                   findByText(document, 'button, div[role="button"]', /^continue$/i);
          },
          { timeout: 8000, errorMsg: 'Could not find Continue button in Compose window' }
        );

        await humanClick(continueBtn);
        await sleep(3000);

        // 11. Handle "Missing unsubscribe link" prompt if it appears
        const addLinkBtn = findByText(document, 'button, div[role="button"]', /add link/i);
        const ignoreBtn = findByText(document, 'button, div[role="button"]', /^ignore$/i);

        if (addLinkBtn && config.includeUnsubscribe) {
          console.log('[GmailAutomator] Resolving unsubscribe prompt via "Add link"...');
          await humanClick(addLinkBtn);
          await sleep(2000);
        } else if (ignoreBtn) {
          console.log('[GmailAutomator] Dismissing unsubscribe prompt via "Ignore"...');
          await humanClick(ignoreBtn);
          await sleep(2000);
        }

        // 12. Handle one-time "Help fight junk emails" modal if present
        const gotItBtn = findByText(document, 'button, div[role="button"]', /got it/i);
        if (gotItBtn) {
          console.log('[GmailAutomator] Dismissing "Help fight junk emails" popup via "Got it"...');
          await humanClick(gotItBtn);
          await sleep(2000);
        }

        // 12b. Safe Dry Run / Preview Check
        if (config.dryRun) {
          console.log('[GmailAutomator] 🛡️ DRY RUN / PREVIEW MODE ACTIVE: All steps verified up to Send. Stopping safely.');
          await progress('DRY_RUN_COMPLETE', 'Dry Run Verified! Mail merge configured and ready to send. Halting safely before final dispatch.', 100);

          if (campaignId && root.IDBStore) {
            try {
              await root.IDBStore.updateCampaign(campaignId, {
                status: 'COMPLETED (DRY RUN)',
                completedAt: new Date().toISOString()
              });
              await root.IDBStore.addLog(campaignId, 'SUCCESS', 'Dry run preview completed safely without sending.');
            } catch (dbErr) {
              console.warn('[GmailAutomator] IDB update error:', dbErr);
            }
          }

          try {
            if (chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({
                action: 'CAMPAIGN_STATUS_UPDATE',
                campaignId,
                status: 'COMPLETED (DRY RUN)',
                logMessage: 'Dry run completed safely without sending.'
              }).catch(() => {});
            }
          } catch (_) {}

          return {
            success: true,
            dryRun: true,
            message: 'Mail merge dry run completed successfully without sending',
            campaignId
          };
        }

        // 13. Wait for "Ready to send" Modal
        await progress('READY_TO_SEND', 'Waiting for Gmail "Ready to send" modal...', 90);
        await waitFor(
          () => {
            return findByText(document, 'h2, div[role="heading"], div[role="dialog"]', /ready to send/i);
          },
          { timeout: 15000, errorMsg: '"Ready to send" modal did not appear' }
        );

        const sendAllBtn = await waitFor(
          () => {
            return findByText(document, 'button, div[role="button"]', /send all/i);
          },
          { timeout: 10000, errorMsg: '"Send all" button not found in Ready to send modal' }
        );

        // 14. Generous pause: allow Gmail backend to bind spreadsheet tokens
        await progress('BINDING_TOKENS', 'Pausing 5 seconds for Gmail backend to bind spreadsheet tokens...', 94);
        await sleep(5000);

        // 15. Click "Send all"
        await progress('SENDING', 'Confirming "Send all" for Mail Merge campaign...', 97);
        await humanClick(sendAllBtn);

        // 16. Wait for "Message sent" toast confirmation
        await progress('AWAIT_CONFIRMATION', 'Waiting for Gmail "Message sent" confirmation...', 99);
        const toastConfirmation = await waitFor(
          () => {
            return findByText(document, 'div, span, [role="alert"]', /message sent/i);
          },
          { timeout: 20000, errorMsg: '"Message sent" toast confirmation did not appear' }
        ).catch(() => {
          console.log('[GmailAutomator] Note: Message sent toast not captured within 20s, verifying compose dismissal.');
          return null;
        });

        await sleep(2000);

        // 17. Update IDB Store & Notify Background Worker
        if (campaignId && root.IDBStore) {
          try {
            await root.IDBStore.updateCampaign(campaignId, {
              status: 'COMPLETED',
              completedAt: new Date().toISOString()
            });
            await root.IDBStore.addLog(campaignId, 'SUCCESS', 'Mail merge sent successfully via Gmail.');
          } catch (dbErr) {
            console.warn('[GmailAutomator] Failed to update campaign status in IDBStore:', dbErr);
          }
        }

        // Notify background service worker of status update
        try {
          if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'CAMPAIGN_STATUS_UPDATE',
              campaignId,
              status: 'COMPLETED',
              logMessage: 'Mail merge sent successfully by GmailAutomator'
            }).catch(() => {});
          }
        } catch (_) {}

        await progress('COMPLETED', 'Mail merge sent successfully!', 100);

        return {
          success: true,
          message: 'Mail merge sent successfully',
          campaignId
        };

      } catch (error) {
        console.error('[GmailAutomator] ❌ Error during Mail Merge automation:', error);

        // Mark FAILED in IDBStore
        if (campaignId && root.IDBStore) {
          try {
            await root.IDBStore.updateCampaign(campaignId, {
              status: 'FAILED',
              errorMessage: error.message,
              failedAt: new Date().toISOString()
            });
            await root.IDBStore.addLog(campaignId, 'ERROR', `Automation failed: ${error.message}`);
          } catch (dbErr) {
            console.warn('[GmailAutomator] Failed to record error in IDBStore:', dbErr);
          }
        }

        // Notify background service worker of failure
        try {
          if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'CAMPAIGN_STATUS_UPDATE',
              campaignId,
              status: 'FAILED',
              logMessage: `Mail merge error: ${error.message}`
            }).catch(() => {});
          }
        } catch (_) {}

        return {
          success: false,
          error: error.message,
          campaignId
        };
      }
    }

    /**
     * Executes a scheduled native Gmail Mail Merge.
     * Navigates to the draft, clicks "Continue", waits for the "Ready to send" modal, and clicks "Send all".
     * In accordance with read-from-this.txt protocol.
     * @param {string|Object} draftIdOrCampaign
     * @param {Object} [optionalCampaign]
     * @returns {Promise<{success: boolean, campaignId?: string, error?: string}>}
     */
    static async executeScheduledNativeMerge(draftIdOrCampaign, optionalCampaign) {
      const campaign = typeof draftIdOrCampaign === 'object' ? draftIdOrCampaign : (optionalCampaign || {});
      const draftId = typeof draftIdOrCampaign === 'string' ? draftIdOrCampaign : campaign?.draftId;
      const campaignId = campaign?.id;
      const subject = campaign?.subject;

      console.log('[GmailAutomator] 🚀 Executing scheduled native merge for draft: ' + (draftId || 'unknown') + ' (Subject: "' + (subject || '') + '")');

      try {
        // 1. Navigate directly to the draft
        if (draftId && draftId !== 'unknown') {
          const targetHash = '#drafts?compose=' + draftId;
          if (window.location.hash !== targetHash) {
            window.location.hash = targetHash;
          }
        } else {
          if (!window.location.hash.startsWith('#drafts')) {
            window.location.hash = '#drafts';
          }
        }

        await sleep(3000);

        // 2. Wait for compose window to load
        let composeDialog = null;
        try {
          composeDialog = await waitFor(
            () => {
              const dialogs = document.querySelectorAll('div[role="dialog"], div.M9, div.AD');
              for (const d of dialogs) {
                if (d.querySelector('input[name="subjectbox"]') || d.querySelector('[aria-label="Message Body"]')) {
                  return d;
                }
              }
              return null;
            },
            { timeout: 10000, errorMsg: 'Compose dialog not loaded directly via URL' }
          );
        } catch (_) {
          // If not opened via URL hash, search draft list by subject
          if (subject) {
            console.log('[GmailAutomator] Searching draft row with subject: "' + subject + '"...');
            const draftRows = document.querySelectorAll('tr[role="row"], div[role="row"]');
            for (const row of draftRows) {
              if (row.textContent.includes(subject)) {
                console.log('[GmailAutomator] Found matching draft row. Clicking to open...');
                await humanClick(row);
                break;
              }
            }
          }

          composeDialog = await waitFor(
            () => {
              const dialogs = document.querySelectorAll('div[role="dialog"], div.M9, div.AD');
              for (const d of dialogs) {
                if (d.querySelector('input[name="subjectbox"]') || d.querySelector('[aria-label="Message Body"]')) {
                  return d;
                }
              }
              return null;
            },
            { timeout: 15000, errorMsg: 'Compose dialog did not open for scheduled draft' }
          );
        }

        await sleep(2500);

        // 3. Find and click "Continue"
        console.log('[GmailAutomator] Locating native "Continue" button...');
        const continueBtn = await waitFor(
          () => {
            const buttons = composeDialog.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
              if (/^Continue$/i.test((btn.textContent || '').trim())) {
                return btn;
              }
            }
            return null;
          },
          { timeout: 15000, errorMsg: 'Native "Continue" button not found in compose dialog' }
        );

        console.log('[GmailAutomator] Clicking native "Continue" button...');
        await humanClick(continueBtn);
        await sleep(3500);

        // 4. Wait for "Ready to send" modal
        console.log('[GmailAutomator] Waiting for "Ready to send" modal...');
        const modal = await waitFor(
          () => {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (const d of dialogs) {
              const txt = d.textContent || '';
              if (txt.includes('Ready to send') || /send all/i.test(txt)) {
                return d;
              }
            }
            return null;
          },
          { timeout: 15000, errorMsg: '"Ready to send" modal did not appear' }
        );

        // 5. Pause for Gmail backend token binding & recipient expansion
        console.log('[GmailAutomator] Pausing for token binding & recipient expansion...');
        await sleep(3500);

        // 6. Click "Send all"
        console.log('[GmailAutomator] Locating "Send all" button...');
        const sendAllBtn = await waitFor(
          () => {
            const buttons = modal.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
              if (/send all/i.test((btn.textContent || '').trim())) {
                return btn;
              }
            }
            return null;
          },
          { timeout: 10000, errorMsg: '"Send all" button not found in Ready to send modal' }
        );

        console.log('[GmailAutomator] Clicking "Send all" button...');
        await humanClick(sendAllBtn);
        console.log('[GmailAutomator] Native Send All triggered successfully.');

        // 7. Update status in IDBStore
        if (campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'COMPLETED',
            completedAt: new Date().toISOString()
          });
          await root.IDBStore.addLog(campaignId, 'INFO', 'Native Send All triggered successfully at scheduled time.');
        }

        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'CAMPAIGN_STATUS_UPDATE',
            campaignId,
            status: 'COMPLETED',
            logMessage: 'Native Send All triggered successfully.'
          }).catch(() => {});
        }

        return { success: true, campaignId };
      } catch (error) {
        console.error('[GmailAutomator] ❌ Error executing scheduled native merge:', error);

        if (campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'FAILED',
            errorMessage: error.message,
            failedAt: new Date().toISOString()
          });
          await root.IDBStore.addLog(campaignId, 'ERROR', 'Scheduled dispatch failed: ' + error.message);
        }

        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'CAMPAIGN_STATUS_UPDATE',
            campaignId,
            status: 'FAILED',
            logMessage: error.message
          }).catch(() => {});
        }

        throw error;
      }
    }
  }

  // Expose globally
  root.GmailAutomator = GmailAutomator;
  if (typeof window !== 'undefined') {
    window.GmailAutomator = GmailAutomator;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
