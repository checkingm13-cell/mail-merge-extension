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
        const result = await predicate();
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

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Automatically detects and dismisses Google's bulk sender / spam policy warning modal.
   * Auto-checks "Don't show again" and clicks "Got it" or "Continue".
   * @param {Document|Element} root
   * @returns {Promise<boolean>} True if disclaimer was found and dismissed
   */
  async function dismissGoogleSpamDisclaimerIfNeeded(root = document) {
    try {
      const dialogs = root.querySelectorAll('div[role="dialog"]');
      for (const dialog of dialogs) {
        if (!isElementVisible(dialog)) continue;
        const text = (dialog.textContent || '').toLowerCase();

        // Check for spam / junk / bulk email disclaimer patterns
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
          console.log('[GmailAutomator] 🛡️ Detected Google spam/junk policy disclaimer. Auto-handling...');

          // 1. Locate and check the "Don't show this again" checkbox
          const checkbox = dialog.querySelector('input[type="checkbox"], div[role="checkbox"]');
          if (checkbox) {
            const isChecked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
            if (!isChecked) {
              await humanClick(checkbox);
              await sleep(150);
            }
          }

          // 2. Locate and click the confirmation button ("Got it", "Continue", "OK", "Acknowledge")
          const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
          const confirmBtn = buttons.find((b) => {
            const btnText = (b.textContent || '').trim().toLowerCase();
            return /^(got it|continue|ok|i understand|proceed|acknowledge|agree)$/i.test(btnText);
          }) || buttons.find((b) => /got it|continue|ok/i.test((b.textContent || '').trim()));

          if (confirmBtn) {
            await humanClick(confirmBtn);
            await sleep(500);
            console.log('[GmailAutomator] ✅ Google spam/junk disclaimer automatically dismissed with "Don\'t show again".');
            return true;
          }
        }
      }
    } catch (err) {
      console.warn('[GmailAutomator] Error handling spam disclaimer note:', err);
    }
    return false;
  }

  /**
   * Executes a robust click with element readiness check, visual pulse, and state verification with retries
   * @param {Function} elementGetter - () => Element|null
   * @param {Function} stateValidator - () => boolean|Element|Promise<boolean|Element>
   * @param {Object} options
   * @returns {Promise<any>}
   */
  async function robustClick(elementGetter, stateValidator, {
    maxRetries = 3,
    retryDelay = 1500,
    actionName = 'Click',
    timeoutPerAttempt = 3500
  } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[GmailAutomator] 🎯 ${actionName}: Attempt ${attempt}/${maxRetries}...`);

      try {
        // 1. Wait for element to be present, visible, and enabled
        const el = await waitFor(
          () => {
            const target = elementGetter();
            if (!target || !isElementVisible(target)) return null;
            const isDisabled = target.disabled === true
              || target.getAttribute('aria-disabled') === 'true'
              || (target.classList && target.classList.contains('disabled'));
            if (isDisabled) return null;
            return target;
          },
          { timeout: 7000, errorMsg: `${actionName}: Element not found or disabled` }
        );

        // 2. Visual highlight effect
        const originalOutline = el.style.outline;
        const originalBoxShadow = el.style.boxShadow;
        el.style.outline = '2px solid #a855f7';
        el.style.boxShadow = '0 0 12px rgba(168, 85, 247, 0.7)';

        // 3. Human click execution
        await humanClick(el);

        // Clean up visual highlight
        setTimeout(() => {
          try {
            el.style.outline = originalOutline;
            el.style.boxShadow = originalBoxShadow;
          } catch (_) {}
        }, 600);

        // 4. Validate target state
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutPerAttempt) {
          try {
            const stateResult = await stateValidator();
            if (stateResult) {
              console.log(`[GmailAutomator] ✅ ${actionName}: Target state verified on attempt ${attempt}.`);
              return stateResult;
            }
          } catch (stateErr) {
            if (stateErr && stateErr.isFatal) {
              throw stateErr;
            }
          }
          await sleep(250);
        }

        console.warn(`[GmailAutomator] ⚠️ ${actionName}: Target state not confirmed within ${timeoutPerAttempt}ms on attempt ${attempt}.`);
      } catch (err) {
        if (err && err.isFatal) {
          throw err;
        }
        lastError = err;
        console.warn(`[GmailAutomator] ⚠️ ${actionName}: Attempt ${attempt} failed: ${err.message}`);
      }

      if (attempt < maxRetries) {
        await sleep(retryDelay);
      }
    }

    throw new Error(`${actionName} failed after ${maxRetries} attempts. ${lastError ? lastError.message : 'Target state not reached.'}`);
  }

  // =========================================================================
  // EXECUTION HUD (In-Tab Live Floating Status Indicator)
  // =========================================================================

  const ExecutionHUD = {
    CARD_ID: 'mm-execution-hud',
    steps: [
      { id: 'NAVIGATE', label: 'Opening Draft URL', icon: '🗂️' },
      { id: 'LOAD_DRAFT', label: 'Loading Compose Window', icon: '✍️' },
      { id: 'CLICK_CONTINUE', label: 'Clicking "Continue"', icon: '🔘' },
      { id: 'WAIT_MODAL', label: 'Verifying "Ready to send" modal', icon: '🔍' },
      { id: 'SEND_ALL', label: 'Clicking "Send all"', icon: '🚀' },
      { id: 'COMPLETED', label: 'Campaign Sent Successfully', icon: '✅' }
    ],

    show(campaign) {
      this.remove();
      const card = document.createElement('div');
      card.id = this.CARD_ID;
      card.style.cssText = [
        'position: fixed',
        'bottom: 24px',
        'right: 24px',
        'width: 360px',
        'background: #1e1e24',
        'color: #ffffff',
        'border-radius: 12px',
        'box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0,0,0,0.2)',
        'border: 1px solid #333644',
        'z-index: 2147483647',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        'padding: 16px',
        'box-sizing: border-box',
        'overflow: hidden',
        'transition: opacity 0.3s ease, transform 0.3s ease'
      ].join('; ');

      const subject = campaign?.subject || 'Scheduled Campaign';
      const audience = campaign?.recipientCount ? `👥 ${campaign.recipientCount} recipients` : '👥 Mail Merge';

      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div id="mmHudSpinner" style="width: 14px; height: 14px; border: 2px solid rgba(168, 85, 247, 0.3); border-top-color: #a855f7; border-radius: 50%; animation: mmSpin 0.8s linear infinite;"></div>
            <span style="font-weight: 700; font-size: 13px; letter-spacing: 0.3px; color: #f3f4f6;">DISPATCHING CAMPAIGN</span>
          </div>
          <span style="font-size: 11px; background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 2px 8px; border-radius: 10px; font-weight: 600;">
            ${audience}
          </span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 12px;" title="${escapeHtml(subject)}">
          ${escapeHtml(subject)}
        </div>
        <!-- Progress Bar -->
        <div style="background: #2d313f; border-radius: 6px; height: 6px; overflow: hidden; margin-bottom: 14px; position: relative;">
          <div id="mmHudProgressFill" style="background: linear-gradient(90deg, #9333ea, #3b82f6); width: 10%; height: 100%; transition: width 0.4s ease; border-radius: 6px;"></div>
        </div>
        <!-- Steps Checklist -->
        <div id="mmHudSteps" style="display: flex; flex-direction: column; gap: 7px; font-size: 12px;">
          ${this.steps.map((s, idx) => `
            <div id="mmStep_${s.id}" style="display: flex; align-items: center; justify-content: space-between; color: ${idx === 0 ? '#ffffff' : '#9ca3af'}; transition: color 0.2s ease;">
              <span style="display: flex; align-items: center; gap: 8px;">
                <span id="mmStepIcon_${s.id}" style="font-size: 13px;">${idx === 0 ? '⏳' : '⚪'}</span>
                <span>${s.label}</span>
              </span>
              <span id="mmStepStatus_${s.id}" style="font-size: 11px; font-weight: 500; color: ${idx === 0 ? '#c084fc' : '#6b7280'};">${idx === 0 ? 'In progress...' : 'Pending'}</span>
            </div>
          `).join('')}
        </div>
        <!-- Error Container -->
        <div id="mmHudErrorBox" style="display: none; margin-top: 12px; padding: 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; font-size: 11px;">
          <div style="font-weight: 700; margin-bottom: 2px;">⚠️ Execution Error</div>
          <div id="mmHudErrorText" style="word-break: break-word;"></div>
          <button id="mmHudDismissBtn" type="button" style="margin-top: 8px; background: #ef4444; color: #ffffff; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 600;">Dismiss</button>
        </div>
      `;

      if (!document.getElementById('mm-hud-styles')) {
        const style = document.createElement('style');
        style.id = 'mm-hud-styles';
        style.textContent = `
          @keyframes mmSpin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(card);
    },

    update(stepId, message, pct) {
      const card = document.getElementById(this.CARD_ID);
      if (!card) return;

      const fill = card.querySelector('#mmHudProgressFill');
      if (fill && pct !== undefined) {
        fill.style.width = pct + '%';
      }

      let reached = false;
      for (const s of this.steps) {
        const row = card.querySelector('#mmStep_' + s.id);
        const icon = card.querySelector('#mmStepIcon_' + s.id);
        const status = card.querySelector('#mmStepStatus_' + s.id);
        if (!row) continue;

        if (s.id === stepId) {
          reached = true;
          row.style.color = '#ffffff';
          row.style.fontWeight = '600';
          if (icon) icon.textContent = '⏳';
          if (status) {
            status.textContent = message || 'Active';
            status.style.color = '#c084fc';
          }
        } else if (!reached) {
          row.style.color = '#9ca3af';
          row.style.fontWeight = 'normal';
          if (icon) icon.textContent = '✅';
          if (status) {
            status.textContent = 'Done';
            status.style.color = '#10b981';
          }
        } else {
          row.style.color = '#6b7280';
          row.style.fontWeight = 'normal';
          if (icon) icon.textContent = '⚪';
          if (status) {
            status.textContent = 'Pending';
            status.style.color = '#4b5563';
          }
        }
      }
    },

    complete(finalCount) {
      const card = document.getElementById(this.CARD_ID);
      if (!card) return;

      const fill = card.querySelector('#mmHudProgressFill');
      if (fill) {
        fill.style.width = '100%';
        fill.style.background = '#10b981';
      }

      const spinner = card.querySelector('#mmHudSpinner');
      if (spinner) {
        spinner.style.border = 'none';
        spinner.style.animation = 'none';
        spinner.innerHTML = '✅';
      }

      for (const s of this.steps) {
        const icon = card.querySelector('#mmStepIcon_' + s.id);
        const status = card.querySelector('#mmStepStatus_' + s.id);
        if (icon) icon.textContent = '✅';
        if (status) {
          status.textContent = 'Done';
          status.style.color = '#10b981';
        }
      }

      const compRow = card.querySelector('#mmStep_COMPLETED');
      if (compRow) {
        compRow.style.color = '#34d399';
        compRow.style.fontWeight = '700';
        const st = card.querySelector('#mmStepStatus_COMPLETED');
        if (st) {
          st.textContent = finalCount ? `${finalCount} sent` : 'Sent!';
          st.style.color = '#34d399';
        }
      }

      setTimeout(() => {
        if (card && card.parentElement) {
          card.style.opacity = '0';
          card.style.transform = 'translateY(20px)';
          setTimeout(() => this.remove(), 400);
        }
      }, 4000);
    },

    error(errorMessage, stepId) {
      const card = document.getElementById(this.CARD_ID);
      if (!card) return;

      const fill = card.querySelector('#mmHudProgressFill');
      if (fill) fill.style.background = '#ef4444';

      const spinner = card.querySelector('#mmHudSpinner');
      if (spinner) {
        spinner.style.border = 'none';
        spinner.style.animation = 'none';
        spinner.innerHTML = '❌';
      }

      if (stepId) {
        const icon = card.querySelector('#mmStepIcon_' + stepId);
        const status = card.querySelector('#mmStepStatus_' + stepId);
        if (icon) icon.textContent = '❌';
        if (status) {
          status.textContent = 'Failed';
          status.style.color = '#ef4444';
        }
      }

      const errBox = card.querySelector('#mmHudErrorBox');
      const errTxt = card.querySelector('#mmHudErrorText');
      if (errBox && errTxt) {
        errTxt.textContent = errorMessage || 'Unknown error occurred during automation.';
        errBox.style.display = 'block';
        const btn = card.querySelector('#mmHudDismissBtn');
        if (btn) btn.onclick = () => this.remove();
      }
    },

    remove() {
      const existing = document.getElementById(this.CARD_ID);
      if (existing) existing.remove();
    }
  };

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
     * Strictly locates and verifies a Compose dialog belonging to the target campaign.
     * Evaluates Draft ID, non-empty Subject, and Google Sheet / Mail Merge presence.
     * Prevents ever touching or sending unrelated or human drafts.
     * @param {string} draftId
     * @param {Object} campaign
     * @param {Element|Document} [doc]
     * @returns {Element|null}
     */
    static findStrictMatchingComposeDialog(draftId, campaign, doc = document) {
      const dialogs = doc.querySelectorAll('div[role="dialog"], div.M9, div.AD');
      const expectedSubject = (campaign?.subject || '').trim().toLowerCase();
      const expectedSheetId = campaign?.sheetId;
      const expectedSheetTitle = (campaign?.sheetTitle || '').trim().toLowerCase();

      const candidates = [];

      for (const d of dialogs) {
        if (!isElementVisible(d)) continue;

        const subjectInput = d.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
        const bodyEl = d.querySelector('[aria-label="Message Body"]');
        if (!subjectInput && !bodyEl) continue; // Not a compose window

        const actualSubject = (subjectInput?.value || '').trim().toLowerCase();
        const actualDraftId = d.querySelector('input[name="draft"]')?.value || d.getAttribute('data-compose-id');

        // Check 1: Subject match
        let subjectMatches = false;
        if (expectedSubject) {
          subjectMatches = (actualSubject === expectedSubject) ||
            (actualSubject.length > 3 && expectedSubject.includes(actualSubject)) ||
            (expectedSubject.length > 3 && actualSubject.includes(expectedSubject));
        } else {
          // If no subject expected, match by draftId or compose token
          subjectMatches = !!(draftId && draftId !== 'unknown' && (actualDraftId === draftId || (window.location.hash && window.location.hash.includes(draftId))));
        }

        // Check 2: Attached Google Sheet or Mail Merge Continue button
        const sheetLink = d.querySelector('a[href*="spreadsheets/d/"], [data-url*="spreadsheets/d/"]');
        const sheetChip = d.querySelector('div[role="button"][aria-label*="sheet" i], span[aria-label*="sheet" i], div.vR, div.afV');
        const continueBtn = Array.from(d.querySelectorAll('button, div[role="button"]')).some((b) => /^(Continue|Send all)$/i.test((b.textContent || '').trim()));

        let sheetMatches = false;
        if (sheetLink && expectedSheetId) {
          sheetMatches = (sheetLink.href || '').includes(expectedSheetId);
        } else if (sheetChip && expectedSheetTitle) {
          sheetMatches = (sheetChip.textContent || '').toLowerCase().includes(expectedSheetTitle);
        } else {
          sheetMatches = !!(sheetLink || sheetChip || continueBtn);
        }

        // Check 3: Draft ID match
        // Note: Gmail draftId can be a URL token (compose=GTv...) or an internal draft id (input[name="draft"]).
        // When the subject matches and the Continue button is present, that is a confirmed match.
        let draftIdMatches = true;
        if (draftId && draftId !== 'unknown' && actualDraftId) {
          draftIdMatches = (actualDraftId === draftId) ||
            (window.location.hash && window.location.hash.includes(draftId)) ||
            (subjectMatches && continueBtn);
        }

        if (subjectMatches && (sheetMatches || continueBtn) && draftIdMatches) {
          let score = 0;
          if (actualDraftId && draftId && actualDraftId === draftId) score += 20;
          if (actualSubject === expectedSubject) score += 15;
          if (sheetMatches) score += 10;
          if (continueBtn) score += 10;
          candidates.push({ dialog: d, score });
        }
      }

      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].dialog;
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
     * Executes a scheduled native Gmail Mail Merge via in-tab sequential queue.
     * Prevents compose window clashing if multiple campaigns fire at the same time.
     */
    static async executeScheduledNativeMerge(draftIdOrCampaign, optionalCampaign) {
      const campaign = typeof draftIdOrCampaign === 'object' ? draftIdOrCampaign : (optionalCampaign || {});
      const draftId = typeof draftIdOrCampaign === 'string' ? draftIdOrCampaign : campaign?.draftId;

      // ponytail: sequential tab queue prevents compose collisions when campaigns share same minute
      if (!GmailAutomator._queue) {
        GmailAutomator._queue = Promise.resolve();
      }

      return new Promise((resolve) => {
        GmailAutomator._queue = GmailAutomator._queue.then(async () => {
          try {
            const res = await GmailAutomator._runSingleExecution(draftId, campaign);
            resolve(res);
          } catch (err) {
            resolve({ success: false, error: err.message });
          }
          await sleep(3000); // 3s buffer before next sequential campaign
        });
      });
    }

    /**
     * Single campaign execution with live progress reporting (10% to 100%).
     */
    static async _runSingleExecution(draftId, campaign) {
      const campaignId = campaign?.id;
      const subject = campaign?.subject;
      let currentStep = 'NAVIGATE';

      // Launch floating Execution HUD in Gmail
      try {
        ExecutionHUD.show(campaign);
      } catch (_) {}

      // Helper to report live progress to IDB, popup, and in-tab HUD
      const reportProgress = async (step, message, pct) => {
        currentStep = step;
        console.log(`[GmailAutomator] [${pct}%] ${step}: ${message}`);
        try {
          ExecutionHUD.update(step, message, pct);
        } catch (_) {}

        if (campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'PROCESSING',
            progressStep: step,
            progressMessage: message,
            progressPct: pct
          }).catch(() => {});
        }
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'CAMPAIGN_PROGRESS',
            campaignId,
            step,
            message,
            pct
          }).catch(() => {});
        }
      };

      // Check if already completed in IDBStore
      if (campaignId && root.IDBStore) {
        try {
          const existing = await root.IDBStore.getCampaignById(campaignId);
          if (existing && existing.status === 'COMPLETED') {
            console.log('[GmailAutomator] Campaign ' + campaignId + ' is already COMPLETED. Skipping.');
            try { ExecutionHUD.remove(); } catch (_) {}
            if (chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({
                action: 'CAMPAIGN_STATUS_UPDATE',
                campaignId,
                status: 'COMPLETED',
                logMessage: 'Campaign was already completed.'
              }).catch(() => {});
            }
            return { success: true, campaignId, status: 'COMPLETED' };
          }
        } catch (_) {}
      }

      console.log('[GmailAutomator] 🚀 Executing scheduled native merge for draft: ' + (draftId || 'unknown') + ' (Subject: "' + (subject || '') + '")');

      try {
        // Auto-dismiss any Google spam / junk policy disclaimer modal right away
        await dismissGoogleSpamDisclaimerIfNeeded(document);

        await reportProgress('NAVIGATE', 'Locating and verifying targeted draft...', 10);

        // 1. First check if matching compose dialog is ALREADY open in this tab
        let composeDialog = GmailAutomator.findStrictMatchingComposeDialog(draftId, campaign);

        if (!composeDialog) {
          await dismissGoogleSpamDisclaimerIfNeeded(document);
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
          await sleep(2500);
          await dismissGoogleSpamDisclaimerIfNeeded(document);
        }

        // 2. Wait for compose window to load with verification
        await reportProgress('LOAD_DRAFT', 'Verifying draft & Mail Merge session...', 30);
        if (!composeDialog) {
          try {
            composeDialog = await waitFor(
              async () => {
                await dismissGoogleSpamDisclaimerIfNeeded(document);
                return GmailAutomator.findStrictMatchingComposeDialog(draftId, campaign);
              },
              { timeout: 15000, errorMsg: 'Target mail merge draft not loaded via URL' }
            );
          } catch (_) {
            await dismissGoogleSpamDisclaimerIfNeeded(document);
            // Fallback: search draft row in drafts list by expected subject
            if (subject) {
              const draftRows = document.querySelectorAll('tr[role="row"], div[role="row"]');
              for (const row of draftRows) {
                const rowText = (row.textContent || '').trim().toLowerCase();
                if (rowText.includes(subject.toLowerCase())) {
                  await humanClick(row);
                  break;
                }
              }
            }

            composeDialog = await waitFor(
              async () => {
                await dismissGoogleSpamDisclaimerIfNeeded(document);
                return GmailAutomator.findStrictMatchingComposeDialog(draftId, campaign);
              },
              { timeout: 15000, errorMsg: 'Target draft not found or did not match mail merge verification' }
            );
          }
        }

        // HARD SAFETY ENFORCEMENT: Never send an unverified draft!
        if (!composeDialog) {
          throw new Error(`Draft Not Found: Could not locate draft "${subject || 'Campaign'}" in your Gmail Drafts folder. It may have been sent or deleted.`);
        }

        // Verify Subject
        const verifySubject = (composeDialog.querySelector('input[name="subjectbox"]')?.value || '').trim();
        if (subject && verifySubject && !verifySubject.toLowerCase().includes(subject.toLowerCase())) {
          throw new Error(`Subject Mismatch: Compose window subject "${verifySubject}" does not match campaign subject "${subject}".`);
        }

        // Verify Mail Merge session
        const continueBtnCheck = Array.from(composeDialog.querySelectorAll('button, div[role="button"]'))
          .some((b) => /^Continue$/i.test((b.textContent || '').trim()));
        const readyModalCheck = Array.from(document.querySelectorAll('div[role="dialog"]'))
          .some((d) => (d.textContent || '').includes('Ready to send'));

        if (!continueBtnCheck && !readyModalCheck) {
          throw new Error(`Mail Merge Inactive: Draft "${verifySubject || subject}" is a standard draft without an active Mail Merge sheet attached (no "Continue" button).`);
        }

        await sleep(2000);

        // Pre-check: dismiss any pre-existing Google spam disclaimer
        const preDismissed = await dismissGoogleSpamDisclaimerIfNeeded(document);
        if (preDismissed && campaignId && root.IDBStore) {
          await root.IDBStore.addLog(campaignId, 'INFO', 'Google bulk email policy disclaimer automatically accepted with "Don\'t show again".').catch(() => {});
        }

        // 3. Find and click "Continue" with state verification and up to 3 retries
        await reportProgress('CLICK_CONTINUE', 'Clicking Continue...', 60);
        const modal = await robustClick(
          () => {
            const buttons = composeDialog.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
              if (/^Continue$/i.test((btn.textContent || '').trim())) {
                return btn;
              }
            }
            return null;
          },
          async () => {
            // If Google intercepted with the spam/junk disclaimer modal, auto-accept and dismiss it
            const intercepted = await dismissGoogleSpamDisclaimerIfNeeded(document);
            if (intercepted && campaignId && root.IDBStore) {
              await root.IDBStore.addLog(campaignId, 'INFO', 'Google bulk email policy disclaimer automatically accepted with "Don\'t show again".').catch(() => {});
            }

            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (const d of dialogs) {
              const txt = (d.textContent || '').trim();

              // Check for Google Sheet error popup ("Can't open the sheet")
              if (txt.includes("Can't open the sheet") || txt.includes("cannot open the sheet") || txt.includes("try another sheet")) {
                console.warn('[GmailAutomator] ❌ Detected Google "Can\'t open the sheet" error dialog.');
                const backBtn = Array.from(d.querySelectorAll('button, div[role="button"]'))
                  .find((b) => /back to draft|close|cancel/i.test((b.textContent || '').trim()));
                if (backBtn) {
                  await humanClick(backBtn);
                  await sleep(400);
                }
                const fatalErr = new Error('Google Sheet Access Error: Gmail reported "Can\'t open the sheet". Please verify Google Sheet permissions for this account, ensure the sheet was not moved or deleted from Google Drive, and complete any "Verify it\'s you" security prompts in Chrome.');
                fatalErr.isFatal = true;
                throw fatalErr;
              }

              if (txt.includes('Ready to send') || /send all/i.test(txt)) {
                return d;
              }
            }
            return null;
          },
          { maxRetries: 3, actionName: 'Click "Continue"', retryDelay: 1500, timeoutPerAttempt: 4000 }
        );

        // 4. Verify "Ready to send" modal and extract live audience count
        await reportProgress('WAIT_MODAL', 'Verifying modal & audience...', 80);
        await sleep(1500);

        let liveRecipientCount = campaign?.recipientCount || null;
        try {
          const modalText = modal.textContent || '';
          console.log('[GmailAutomator] "Ready to send" modal text preview:', modalText.slice(0, 160));
          const countMatch = modalText.match(/(?:send|about to send)?\s*(\d+)\s*(?:separate|personalized)?\s*(?:emails?|recipients?)\b/i)
            || modalText.match(/(\d+)\s*(?:separate|personalized)?\s*emails?\b/i)
            || modalText.match(/(\d+)\s*recipients?\b/i);
          if (countMatch && parseInt(countMatch[1], 10) > 0) {
            liveRecipientCount = parseInt(countMatch[1], 10);
            console.log('[GmailAutomator] Extracted real-time recipient count from modal:', liveRecipientCount);
          }
        } catch (cntErr) {
          console.warn('[GmailAutomator] Failed to parse modal count:', cntErr);
        }

        try {
          ExecutionHUD.update('WAIT_MODAL', liveRecipientCount ? `Ready (${liveRecipientCount} recipients)` : 'Modal verified', 85);
        } catch (_) {}

        await sleep(2000);

        // 5. Click "Send all" with state verification and up to 3 retries
        await reportProgress('SEND_ALL', 'Clicking Send all...', 95);
        await robustClick(
          () => {
            const buttons = modal.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
              if (/send all/i.test((btn.textContent || '').trim())) {
                return btn;
              }
            }
            return null;
          },
          () => {
            // Target state: Modal closed or Gmail confirmation alert
            const modalGone = !modal.isConnected || !isElementVisible(modal);
            const sendingAlert = !!document.querySelector('.vh, [role="alert"], div[aria-live="assertive"]');
            return modalGone || sendingAlert;
          },
          { maxRetries: 3, actionName: 'Click "Send all"', retryDelay: 1200, timeoutPerAttempt: 3000 }
        );

        await sleep(1500);

        // Check for Google daily sending limit alert
        const alertEl = document.querySelector('.vh, [role="alert"], div[aria-live="assertive"]');
        if (alertEl) {
          const alertText = (alertEl.textContent || '').toLowerCase();
          if (alertText.includes('reached a limit') || alertText.includes('sending limit')) {
            throw new Error('Google Daily Sending Limit Reached: Gmail has blocked sending for this account due to 24-hour quota limits.');
          }
        }

        await reportProgress('COMPLETED', 'Sent successfully!', 100);
        try {
          ExecutionHUD.complete(liveRecipientCount);
        } catch (_) {}

        // 6. Update IDBStore & broadcast completion
        if (campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'COMPLETED',
            progressStep: 'COMPLETED',
            progressPct: 100,
            recipientCount: liveRecipientCount,
            sentCount: liveRecipientCount,
            completedAt: new Date().toISOString()
          });
          const logMsg = liveRecipientCount
            ? `Native Send All triggered successfully for ${liveRecipientCount} recipient(s) at scheduled time.`
            : 'Native Send All triggered successfully at scheduled time.';
          await root.IDBStore.addLog(campaignId, 'INFO', logMsg);
        }

        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'CAMPAIGN_STATUS_UPDATE',
            campaignId,
            status: 'COMPLETED',
            sentCount: liveRecipientCount,
            recipientCount: liveRecipientCount,
            logMessage: liveRecipientCount
              ? `Native Send All triggered successfully for ${liveRecipientCount} recipient(s).`
              : 'Native Send All triggered successfully.'
          }).catch(() => {});
        }

        return { success: true, campaignId, sentCount: liveRecipientCount };
      } catch (error) {
        console.error('[GmailAutomator] ❌ Error executing scheduled native merge:', error);
        try {
          ExecutionHUD.error(error.message, currentStep);
        } catch (_) {}

        if (campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'FAILED',
            errorMessage: error.message,
            failedAt: new Date().toISOString()
          }).catch(() => {});
          await root.IDBStore.addLog(campaignId, 'ERROR', 'Scheduled dispatch failed: ' + error.message).catch(() => {});
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
