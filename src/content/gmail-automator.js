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
      console.log('[GmailAutomator] Delegating merge to native scheduled executor...');
      return await GmailAutomator.executeScheduledNativeMerge(campaignConfig);
    }

    /**
     * Executes a scheduled native Gmail Mail Merge.
     * Navigates to the draft, clicks "Continue", waits for the "Ready to send" modal, and clicks "Send all".
     */
    static async executeScheduledNativeMerge(draftIdOrCampaign, optionalCampaign) {
      const campaign = typeof draftIdOrCampaign === 'object' ? draftIdOrCampaign : (optionalCampaign || {});
      const draftId = typeof draftIdOrCampaign === 'string' ? draftIdOrCampaign : campaign?.draftId;
      const campaignId = campaign?.id;
      const subject = campaign?.subject;

      // Concurrency lock: prevent multiple simultaneous executions of the same campaign
      if (!GmailAutomator._activeExecutions) {
        GmailAutomator._activeExecutions = new Set();
      }
      if (campaignId && GmailAutomator._activeExecutions.has(campaignId)) {
        console.warn('[GmailAutomator] ⚠️ Campaign ' + campaignId + ' is already executing. Ignoring concurrent duplicate trigger.');
        return { success: true, campaignId, warning: 'Already executing' };
      }
      if (campaignId) {
        GmailAutomator._activeExecutions.add(campaignId);
      }

      // Check if already completed in IDBStore
      if (campaignId && root.IDBStore) {
        try {
          const existing = await root.IDBStore.getCampaignById(campaignId);
          if (existing && existing.status === 'COMPLETED') {
            console.log('[GmailAutomator] Campaign ' + campaignId + ' is already COMPLETED. Skipping redundant execution.');
            if (campaignId) GmailAutomator._activeExecutions.delete(campaignId);
            return { success: true, campaignId, status: 'COMPLETED' };
          }
        } catch (_) {}
      }

      console.log('[GmailAutomator] 🚀 Executing scheduled native merge for draft: ' + (draftId || 'unknown') + ' (Subject: "' + (subject || '') + '")');

      try {
        // Check if compose dialog is already open on screen
        let composeDialog = null;
        const openDialogs = document.querySelectorAll('div[role="dialog"], div.M9, div.AD');
        for (const d of openDialogs) {
          if (d.querySelector('input[name="subjectbox"]') || d.querySelector('[aria-label="Message Body"]')) {
            if (!subject || (d.querySelector('input[name="subjectbox"]')?.value || '').includes(subject)) {
              composeDialog = d;
              console.log('[GmailAutomator] Compose dialog for draft is already open on screen.');
              break;
            }
          }
        }

        // 1. Navigate directly to the draft if not already open
        if (!composeDialog) {
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
        }
        // 2. Wait for compose window to load if not yet located
        if (!composeDialog) {
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
          try {
            const current = await root.IDBStore.getCampaignById(campaignId);
            if (current && current.status === 'COMPLETED') {
              console.warn('[GmailAutomator] Campaign ' + campaignId + ' was already marked COMPLETED. Ignoring catch block failure overwrite.');
              return { success: true, campaignId, warning: 'Already completed' };
            }
          } catch (_) {}

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
      } finally {
        if (campaignId && GmailAutomator._activeExecutions) {
          GmailAutomator._activeExecutions.delete(campaignId);
        }
      }
    }
  }

  // Expose globally
  root.GmailAutomator = GmailAutomator;
  if (typeof window !== 'undefined') {
    window.GmailAutomator = GmailAutomator;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
