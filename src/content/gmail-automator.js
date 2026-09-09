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
   * Standardizes dashes, non-breaking spaces, quotes, and whitespace across Gmail DOM and user input
   * @param {string} input
   * @returns {string}
   */
  function normalizeText(input) {
    if (!input || typeof input !== 'string') return '';
    return input
      .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
      .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
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
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (_) {}
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
      try { el.focus(); } catch (_) {}
    }
    await sleep(60);
    el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
    el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    el.dispatchEvent(new MouseEvent('click', eventOpts));

    // Dual-layer native click fallback: ensures triggers fire even if synthetic event was swallowed
    if (typeof el.click === 'function') {
      try {
        el.click();
      } catch (_) {}
    }
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

  let currentActiveCampaign = null;

  /**
   * Captures visual tab screenshot and DOM state for overnight diagnostics
   * @param {string} stage
   * @param {Element|null} [element]
   * @param {string|null} [errorMessage]
   * @param {Object|null} [campaign]
   * @returns {Promise<Object|null>}
   */
  async function captureForensicSnapshot(stage, element = null, errorMessage = null, campaign = null) {
    try {
      if (!chrome.runtime || !chrome.runtime.sendMessage) return null;

      const activeCampaign = campaign || currentActiveCampaign;
      const campaignId = activeCampaign?.id || null;

      let popupInfo = null;
      let domSnippet = null;

      if (element) {
        const titleEl = element.querySelector('h1, h2, h3, div[role="heading"], .modal-header, .Kj-JD-title');
        const title = (titleEl?.textContent || '').trim() || (element.getAttribute('aria-label') || '').trim();
        const bodyText = (element.textContent || '').slice(0, 300).trim();
        popupInfo = { title: title.slice(0, 100), body: bodyText };

        try {
          domSnippet = element.outerHTML ? element.outerHTML.slice(0, 1200) : null;
        } catch (_) {}
      }

      console.log(`[GmailAutomator] 📸 Capturing overnight visual forensic snapshot at stage "${stage}"...`);
      const resp = await chrome.runtime.sendMessage({
        action: 'CAPTURE_TAB_FORENSIC',
        campaignId,
        stage,
        popupInfo,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 400) : null,
        domSnippet
      }).catch(() => null);

      return resp;
    } catch (err) {
      console.warn('[GmailAutomator] Forensic capture note:', err);
      return null;
    }
  }

  /**
   * Captures a lightweight, searchable snapshot of the DOM state at the exact moment of failure.
   * Complements visual screenshots with exact text, button labels, URL hash, and DOM snippets.
   * Overhead is negligible (~1.5 - 2.5 KB JSON), causing zero UI or DB lag.
   * @param {string} [currentStep]
   * @returns {Object}
   */
  function captureFailureContext(currentStep = 'UNKNOWN') {
    try {
      // 1. Capture all open dialogs (Compose, Modals, Popups)
      const dialogElements = Array.from(
        document.querySelectorAll('div[role="dialog"], div[role="alertdialog"], div.Kj-JD, div.M9, div.AD')
      ).filter((d) => d.offsetWidth > 0 && d.offsetHeight > 0);

      const dialogs = dialogElements.map((d) => {
        // Extract all clickable buttons inside the dialog
        const buttons = Array.from(d.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'))
          .map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '))
          .filter((t) => t.length > 0 && t.length < 50);

        // Deduplicate buttons
        const uniqueButtons = Array.from(new Set(buttons));

        // Truncate HTML snippet (max 1500 chars to prevent any DB bloat)
        const htmlSnippet = d.outerHTML ? d.outerHTML.substring(0, 1500) : '';

        return {
          role: d.getAttribute('role') || 'unknown',
          ariaLabel: d.getAttribute('aria-label') || '',
          className: (d.className || '').toString().slice(0, 80),
          visibleButtons: uniqueButtons,
          htmlSnippet: htmlSnippet
        };
      });

      // 2. Visible notification banners / alerts (e.g. daily limit, temporary error)
      const alerts = Array.from(
        document.querySelectorAll('.vh, [role="alert"], div[aria-live="assertive"]')
      )
        .filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0)
        .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '))
        .filter((t) => t.length > 0 && t.length < 160);

      // 3. Capture active focused element
      const ae = document.activeElement;
      let activeElDesc = 'none';
      if (ae && ae !== document.body) {
        const tag = (ae.tagName || '').toLowerCase();
        const cls = ae.className && typeof ae.className === 'string'
          ? '.' + ae.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
        const aria = ae.getAttribute('aria-label') ? `[aria-label="${ae.getAttribute('aria-label')}"]` : '';
        activeElDesc = `${tag}${cls}${aria}`;
      }

      return {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        hash: window.location.hash || '',
        activeElement: activeElDesc,
        lastKnownStep: currentStep || (typeof window !== 'undefined' && window.__MM_LAST_STEP__) || 'UNKNOWN',
        visibleDialogs: dialogs,
        visibleAlerts: Array.from(new Set(alerts))
      };
    } catch (err) {
      return {
        error: 'Failed to capture DOM autopsy',
        message: err.message,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        hash: window.location.hash || ''
      };
    }
  }

  /**
   * Detects Google multi-modal limit, daily sending limit, or quota error alerts
   * across visible banners, toasts, and snackbars.
   * Recognizes "multi-modal limit exceeded", red error snackbars, and all variations.
   * @returns {{ detected: boolean, element: Element, message: string } | null}
   */
  function detectGoogleQuotaOrLimitAlert() {
    try {
      const candidates = Array.from(
        document.querySelectorAll(
          '.vh, [role="alert"], div[aria-live="assertive"], .bBe, .a8, .b8.UC, .aYF, div.Kj-JD, div[role="alertdialog"], span.bAf, span.bAg, div[class*="snackbar"], div[class*="toast"]'
        )
      );

      for (const el of candidates) {
        if (!el || !el.isConnected) continue;

        // Verify element has physical presence / visibility
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const text = (el.textContent || '').toLowerCase().trim();
        if (!text || text.length < 5) continue;

        // 1. Textual patterns for Google sending limits, multi-modal blocks, and quota alerts
        const isQuotaText =
          text.includes('multi-modal limit') ||
          text.includes('multi modal limit') ||
          text.includes('multimodal limit') ||
          text.includes('multi-merge limit') ||
          text.includes('multi merge limit') ||
          text.includes('limit exceeded') ||
          (text.includes('exceeded') && text.includes('limit')) ||
          text.includes('reached a limit') ||
          text.includes('reached your limit') ||
          text.includes('sending limit') ||
          text.includes('daily sending limit') ||
          text.includes('exceeded your sending limit') ||
          text.includes('exceeds your daily sending limit') ||
          text.includes('blocked sending') ||
          (text.includes('quota') && (text.includes('exceeded') || text.includes('limit'))) ||
          ((text.includes('unable to send') || text.includes('could not be sent')) && (text.includes('limit') || text.includes('try again later')));

        // 2. Red toast / snackbar visual color check (Google error red #d93025 / rgb(217, 48, 37))
        let isRedAlert = false;
        try {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor || '';
          isRedAlert =
            bg.includes('217, 48, 37') ||
            bg.includes('217, 48, 38') ||
            bg.includes('234, 67, 53') ||
            bg.includes('220, 38, 38');
        } catch (_) {}

        if (isQuotaText || (isRedAlert && (text.includes('limit') || text.includes('error') || text.includes('failed')))) {
          return {
            detected: true,
            element: el,
            message: (el.textContent || '').trim()
          };
        }
      }
    } catch (_) {}
    return null;
  }

  let activeRetroactiveGuardInterval = null;

  /**
   * Spawns a 15-second retroactive safety guard.
   * If Google displays a late asynchronous rejection red box ("multi-modal limit exceeded"),
   * it intercepts it, retroactively flips the campaign status from COMPLETED -> FAILED (QUOTA_EXCEEDED),
   * captures a screenshot & DOM autopsy, and triggers the 12-hour account pause.
   */
  function startRetroactiveQuotaGuard(campaignId, campaign, recipientCount) {
    if (!campaignId) return;
    if (activeRetroactiveGuardInterval) {
      clearInterval(activeRetroactiveGuardInterval);
    }

    const guardStart = Date.now();
    const GUARD_DURATION_MS = 15000; // 15 seconds

    console.log(`[GmailAutomator] 🛡️ 15s Retroactive Quota Guard armed for campaign ${campaignId}...`);

    activeRetroactiveGuardInterval = setInterval(async () => {
      if (Date.now() - guardStart > GUARD_DURATION_MS) {
        clearInterval(activeRetroactiveGuardInterval);
        activeRetroactiveGuardInterval = null;
        return;
      }

      const alert = detectGoogleQuotaOrLimitAlert();
      if (alert) {
        clearInterval(activeRetroactiveGuardInterval);
        activeRetroactiveGuardInterval = null;

        console.error(`[GmailAutomator] 🚨 Late Google Quota Alert Intercepted (${Math.round((Date.now() - guardStart) / 1000)}s post-send):`, alert.message);

        // 1. Capture visual screenshot of the red box
        await captureForensicSnapshot(
          'LATE_QUOTA_REJECTION',
          alert.element,
          `Late Google Server Rejection: ${alert.message}`,
          campaign
        );

        // 2. Capture DOM Autopsy
        const domAutopsy = captureFailureContext('LATE_QUOTA_REJECTION');

        // 3. Retroactively update campaign in IDB
        if (root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'FAILED',
            errorCategory: 'QUOTA_EXCEEDED',
            errorMessage: `Late Google Server Rejection: "${alert.message.slice(0, 160)}"`,
            canAutoRetry: false,
            failedAt: new Date().toISOString(),
            domAutopsy: domAutopsy
          }).catch(() => {});

          await root.IDBStore.addLog(
            campaignId,
            'ERROR',
            `Campaign retroactively marked FAILED: Google returned asynchronous error "${alert.message}". Account sending paused for 12 hours.`
          ).catch(() => {});
        }

        // 4. Update floating in-tab Execution HUD
        try {
          ExecutionHUD.error(`Quota Exceeded: ${alert.message.slice(0, 60)}`, 'POST_SEND');
        } catch (_) {}

        // 5. Notify service worker to pause account campaigns for 12 hours
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'CAMPAIGN_STATUS_UPDATE',
            campaignId,
            status: 'FAILED',
            errorCategory: 'QUOTA_EXCEEDED',
            isQuotaLimit: true,
            logMessage: `Late Google multi-modal limit exceeded: ${alert.message}`,
            canAutoRetry: false,
            accountEmail: campaign?.accountEmail || campaign?.senderEmail,
            domAutopsy: domAutopsy
          }).catch(() => {});
        }
      }
    }, 1000);
  }

  /**
   * Automatically detects and dismisses interfering Google dialogs:
   * 1. Bulk sender / spam policy warning ("Help fight junk mail") -> checks "Don't show again" + "Got it"
   * 2. "Missing merge tags" dialog -> clicks "Send anyway" so 24/7 campaigns never stall
   * 3. "Which column has recipient email addresses?" -> auto-selects recipient email column + clicks "Done"
   * 4. Generic promotional / onboarding popups ("Got it", "Dismiss", "Not now", "Done")
   * @param {Document|Element} root
   * @param {Object} [campaign]
   * @returns {Promise<boolean>} True if an interfering dialog was found and dismissed
   */
  /**
   * Observes and classifies a dialog element before any action is taken.
   * Returns: 'USER_SCHEDULE_POPOVER' | 'COMPOSE_DIALOG' | 'READY_TO_SEND_MODAL' |
   *          'SPAM_DISCLAIMER' | 'MISSING_MERGE_TAGS' | 'COLUMN_SELECTION' |
   *          'PROMO_POPUP' | 'GENERIC_ALERTDIALOG' | 'UNKNOWN'
   */
  function classifyDialog(dialog) {
    if (!dialog || !isElementVisible(dialog)) return 'NONE';

    // 1. User Campaign Scheduling Popover -> STRICTLY IGNORE (User UI!)
    if (
      dialog.id === 'mmPopoverOverlay' ||
      dialog.id === 'mmPopover' ||
      dialog.id === 'mm-schedule-popover-card' ||
      dialog.getAttribute('data-mm-schedule-popover') === 'true' ||
      dialog.querySelector('#mmDateTimeInput, #mmPopoverConfirm, [data-mm-schedule-popover]') ||
      (dialog.className && typeof dialog.className === 'string' && dialog.className.includes('mm-schedule'))
    ) {
      return 'USER_SCHEDULE_POPOVER';
    }

    // 2. Compose Dialogs -> STRICTLY IGNORE
    const isCompose = dialog.querySelector('input[name="subjectbox"]') || dialog.querySelector('[aria-label="Message Body"]');
    if (isCompose) return 'COMPOSE_DIALOG';

    const text = (dialog.textContent || '').toLowerCase();

    // 3. Target "Ready to send" modal -> NEVER DISMISS
    if (text.includes('ready to send') || text.includes('separate emails') || text.includes('send all')) {
      return 'READY_TO_SEND_MODAL';
    }

    // 4. Google Spam Disclaimer ("Help fight junk emails")
    if (
      (text.includes('spam') || text.includes('junk') || text.includes('bulk email') || text.includes('bulk sender') || text.includes('best practices') || text.includes('fight junk')) &&
      (text.includes("don't show") || text.includes("dont show") || text.includes("do not show") || text.includes("got it") || text.includes("learn more"))
    ) {
      return 'SPAM_DISCLAIMER';
    }

    // 5. Missing merge tags dialog
    if (
      (text.includes('merge tags') || text.includes('merge tag') || text.includes("couldn't be found in your sheet") || text.includes("cannot be found in your sheet")) &&
      (text.includes('send anyway') || text.includes('edit draft'))
    ) {
      return 'MISSING_MERGE_TAGS';
    }

    // 6. Recipient column selection dialog
    if (
      (text.includes('which column') || text.includes("recipients' email") || text.includes("recipient email")) &&
      (text.includes('done') || text.includes('select') || text.includes('insert'))
    ) {
      return 'COLUMN_SELECTION';
    }

    // 7. Google Promotional / Onboarding popups
    if (
      (text.includes("what's new") || text.includes("meet the new") || text.includes("turn on notifications") || text.includes("smart compose") || text.includes("gemini in gmail") || text.includes("try the new") || text.includes("workspace tip")) &&
      !text.includes("can't open the sheet")
    ) {
      return 'PROMO_POPUP';
    }

    // 8. Google Alertdialog (role="alertdialog" or .Kj-JD)
    const isAlert = dialog.getAttribute('role') === 'alertdialog' || dialog.classList.contains('Kj-JD');
    if (isAlert) {
      return 'GENERIC_ALERTDIALOG';
    }

    return 'UNKNOWN';
  }

  /**
   * Observe-First modal handler: observes dialog type, then dispatches through switch.
   * Only executes automated dismissals if an automated campaign is actively executing.
   * @param {Element|Document} root
   * @param {Object|null} campaign
   * @returns {Promise<boolean>} True if an interfering dialog was found and dismissed
   */
  async function dismissGoogleInterferingModalsIfNeeded(root = document, campaign = null) {
    const isAutomatedRun = !!(campaign || currentActiveCampaign);

    try {
      const dialogs = Array.from(root.querySelectorAll('div[role="dialog"], div[role="alertdialog"], div.Kj-JD, [aria-modal="true"], dialog, div[class*="modal"]'));

      // Direct detection: Find any visible element that contains "Help fight junk" or spam policy notice
      if (!dialogs.some((d) => (d.textContent || '').toLowerCase().includes('fight junk'))) {
        const candidates = Array.from(root.querySelectorAll('div, section, article')).filter((el) => {
          if (!isElementVisible(el)) return false;
          const t = (el.textContent || '').toLowerCase();
          return t.includes('help fight junk') || (t.includes('marked as spam') && t.includes('got it'));
        });
        candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        if (candidates.length > 0 && candidates[0]) {
          dialogs.push(candidates[0]);
        }
      }

      let anyDismissed = false;
      for (const dialog of dialogs) {
        if (!isElementVisible(dialog)) continue;
        const type = classifyDialog(dialog);

        switch (type) {
          case 'USER_SCHEDULE_POPOVER':
          case 'COMPOSE_DIALOG':
          case 'READY_TO_SEND_MODAL':
          case 'UNKNOWN':
          case 'NONE':
            // Strictly ignore
            break;

          case 'SPAM_DISCLAIMER': {
            console.log('[GmailAutomator] 🛡️ Handling Google spam/junk policy disclaimer ("Help fight junk emails")...');
            await captureForensicSnapshot('POPUP_INTERCEPTED', dialog, 'Detected Google spam policy disclaimer ("Help fight junk emails")', campaign);
            const checkbox = dialog.querySelector('input[type="checkbox"], [role="checkbox"], div[role="checkbox"], span[role="checkbox"]')
              || Array.from(dialog.querySelectorAll('label, div, span')).find((el) => /don't show|dont show/i.test(el.textContent || ''))?.querySelector('input, [role="checkbox"]');
            if (checkbox) {
              const isChecked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
              if (!isChecked) {
                await humanClick(checkbox);
                await sleep(150);
              }
            }
            const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], .T-I, .jfk-button, [aria-label*="Got it" i]'));
            let confirmBtn = buttons.find((b) => /^(got it|continue|ok|i understand|proceed|acknowledge|agree)$/i.test((b.textContent || '').trim()))
              || buttons.find((b) => /got it|continue|ok/i.test((b.textContent || '').trim()));
            if (!confirmBtn) {
              confirmBtn = Array.from(dialog.querySelectorAll('*')).find((el) => {
                const txt = (el.textContent || '').trim().toLowerCase();
                return (txt === 'got it' || txt === 'ok') && isElementVisible(el);
              });
            }
            if (confirmBtn) {
              await humanClick(confirmBtn);
              try {
                if (typeof confirmBtn.click === 'function') confirmBtn.click();
                confirmBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                confirmBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              } catch (_) {}
              await sleep(400);
              console.log('[GmailAutomator] ✅ Google spam/junk disclaimer ("Help fight junk emails") automatically dismissed.');
              return true;
            }
            break;
          }

          case 'MISSING_MERGE_TAGS': {
            if (!isAutomatedRun) break;
            console.warn('[GmailAutomator] ⚠️ Detected Google "Missing merge tags" modal. Auto-clicking "Send anyway"...');
            await captureForensicSnapshot('MISSING_MERGE_TAGS', dialog, 'Google warned of missing merge tags in draft body', campaign);
            const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], .T-I, .jfk-button, [aria-label*="Send anyway" i]'));
            let sendAnywayBtn = buttons.find((b) => /send anyway/i.test((b.textContent || '').trim()));
            if (!sendAnywayBtn) {
              sendAnywayBtn = Array.from(dialog.querySelectorAll('*')).find((el) => isElementVisible(el) && /send anyway/i.test((el.textContent || '').trim()));
            }
            if (sendAnywayBtn) {
              await humanClick(sendAnywayBtn);
              try {
                if (typeof sendAnywayBtn.click === 'function') sendAnywayBtn.click();
                sendAnywayBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                sendAnywayBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              } catch (_) {}
              await sleep(400);
              if (campaign?.id && root.IDBStore) {
                await root.IDBStore.addLog(campaign.id, 'WARN', 'Google warned of missing merge tags in draft body. Auto-clicked "Send anyway" per unattended 24/7 policy.').catch(() => {});
              }
              return true;
            }
            break;
          }

          case 'COLUMN_SELECTION': {
            if (!isAutomatedRun) break;
            console.log('[GmailAutomator] 🔍 Detected Google column selection prompt. Auto-selecting email column...');
            await captureForensicSnapshot('COLUMN_SELECTION_PROMPT', dialog, 'Google prompted for recipient email column selection', campaign);
            const selectEl = dialog.querySelector('select');
            if (selectEl) {
              const targetCol = (campaign?.recipientColumn || 'email').toLowerCase().trim();
              const option = Array.from(selectEl.options).find((o) => (o.text || '').toLowerCase().includes(targetCol))
                || Array.from(selectEl.options).find((o) => /email|mail|address|contact/i.test(o.text || ''));
              if (option) {
                selectEl.value = option.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], .T-I, .jfk-button'));
            let doneBtn = buttons.find((b) => /^(done|insert|select|ok)$/i.test((b.textContent || '').trim()));
            if (!doneBtn) {
              doneBtn = Array.from(dialog.querySelectorAll('*')).find((el) => isElementVisible(el) && /^(done|insert|select|ok)$/i.test((el.textContent || '').trim()));
            }
            if (doneBtn) {
              await humanClick(doneBtn);
              try {
                if (typeof doneBtn.click === 'function') doneBtn.click();
                doneBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                doneBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              } catch (_) {}
              await sleep(400);
              return true;
            }
            break;
          }

          case 'PROMO_POPUP': {
            console.log('[GmailAutomator] 🛡️ Dismissing promotional / onboarding popup...');
            await captureForensicSnapshot('PROMOTIONAL_POPUP', dialog, 'Google promotional modal detected', campaign);
            const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], .T-I, .jfk-button, [aria-label*="close" i], [aria-label*="dismiss" i]'));
            let dismissBtn = buttons.find((b) => /^(got it|not now|dismiss|done|close|no thanks)$/i.test((b.textContent || '').trim()))
              || dialog.querySelector('[aria-label="Close" i], [aria-label="Dismiss" i]');
            if (!dismissBtn) {
              dismissBtn = Array.from(dialog.querySelectorAll('*')).find((el) => isElementVisible(el) && /^(got it|not now|dismiss|done|close|no thanks)$/i.test((el.textContent || '').trim()));
            }
            if (dismissBtn) {
              await humanClick(dismissBtn);
              try {
                if (typeof dismissBtn.click === 'function') dismissBtn.click();
                dismissBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                dismissBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              } catch (_) {}
              await sleep(400);
              return true;
            }
            break;
          }

          case 'GENERIC_ALERTDIALOG': {
            // ONLY auto-dismiss if an automated campaign is actively running!
            // Never dismiss when a human user is manually interacting with Gmail!
            if (!isAutomatedRun) break;
            const alertButtons = Array.from(dialog.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], .T-I, .jfk-button'));
            let okBtn = alertButtons.find((b) => /^(ok|dismiss|got it|close|acknowledge|i understand)$/i.test((b.textContent || '').trim()))
              || dialog.querySelector('[aria-label="OK" i], [aria-label="Dismiss" i], [aria-label="Close" i]');
            if (!okBtn) {
              okBtn = Array.from(dialog.querySelectorAll('*')).find((el) => isElementVisible(el) && /^(ok|dismiss|got it|close)$/i.test((el.textContent || '').trim()));
            }

            if (okBtn) {
              const alertText = (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150);
              console.warn(`[GmailAutomator] 🛡️ Auto-dismissing blocking alertdialog during automated run: "${alertText}"`);
              await captureForensicSnapshot('ALERTDIALOG_DISMISSED', dialog, `Dismissed alertdialog: ${alertText}`, campaign);
              if (campaign?.id && root.IDBStore) {
                await root.IDBStore.addLog(campaign.id, 'WARN', `Auto-dismissed Google alertdialog: "${alertText}"`).catch(() => {});
              }
              await humanClick(okBtn);
              try {
                if (typeof okBtn.click === 'function') okBtn.click();
                okBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                okBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              } catch (_) {}
              await sleep(300);
              anyDismissed = true;
            }
            break;
          }
        }
      }
      return anyDismissed;
    } catch (err) {
      console.warn('[GmailAutomator] Error handling interfering modals note:', err);
    }
    return false;
  }

  // Backward compatibility alias
  const dismissGoogleSpamDisclaimerIfNeeded = dismissGoogleInterferingModalsIfNeeded;

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
        // Clear any blocking Google modal or disclaimer before attempting click
        await dismissGoogleInterferingModalsIfNeeded(document);
        await sleep(150);

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

    // Capture visual snapshot at moment of click failure
    await captureForensicSnapshot(
      'CLICK_FAILED',
      document.querySelector('div[role="dialog"], div[role="alertdialog"], div.Kj-JD, div.AD') || document.body,
      `${actionName} failed after ${maxRetries} attempts. ${lastError ? lastError.message : 'Target state not reached.'}`
    );

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
     * Dismisses interfering Google modals (spam notices, missing tags, column selectors, promos)
     */
    static async dismissGoogleInterferingModalsIfNeeded(root = document, campaign = null) {
      return await dismissGoogleInterferingModalsIfNeeded(root, campaign);
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
        'div[role="button"][gh="cm"]',
        'button[aria-label="Compose"]',
        '.T-I-KE',
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
      const expectedSubject = normalizeText(campaign?.subject);
      const isGenericSubject = !expectedSubject || expectedSubject.startsWith('mail merge (');
      const expectedSheetId = campaign?.sheetId;
      const expectedSheetTitle = normalizeText(campaign?.sheetTitle);

      const candidates = [];

      for (const d of dialogs) {
        if (!isElementVisible(d)) continue;

        const subjectInput = d.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
        const headerTitle = (d.querySelector('h2, div[role="heading"], div.aaq, div.aAU, div.Hp, span.aYF')?.textContent || '').trim();
        const bodyEl = d.querySelector('[aria-label="Message Body"]');
        if (!subjectInput && !bodyEl && !headerTitle) continue; // Not a compose window

        const actualSubject = normalizeText(subjectInput?.value || headerTitle);
        const actualDraftId = d.querySelector('input[name="draft"]')?.value || d.getAttribute('data-compose-id');

        // Check 1: Subject match with Unicode dash, quote, and NBSP normalization
        let subjectMatches = false;
        if (!isGenericSubject && actualSubject) {
          subjectMatches = (actualSubject === expectedSubject) ||
            (actualSubject.length > 3 && expectedSubject.includes(actualSubject)) ||
            (expectedSubject.length > 3 && actualSubject.includes(expectedSubject));
        } else {
          // If expected subject is a generic fallback ("Mail Merge (9/8/2026)") or empty,
          // do not block the open draft on subject mismatch!
          subjectMatches = true;
        }

        // Check 2: Attached Google Sheet or Mail Merge Continue button
        const sheetLink = d.querySelector('a[href*="spreadsheets/d/"], [data-url*="spreadsheets/d/"]');
        const sheetChip = d.querySelector('div[role="button"][aria-label*="sheet" i], span[aria-label*="sheet" i], div.vR, div.afV');
        const continueBtn = Array.from(d.querySelectorAll('button, div[role="button"]')).some((b) => /^(Continue|Send all)$/i.test((b.textContent || '').trim()));

        let sheetMatches = false;
        if (sheetLink && expectedSheetId) {
          sheetMatches = (sheetLink.href || '').includes(expectedSheetId);
        } else if (sheetChip && expectedSheetTitle) {
          sheetMatches = normalizeText(sheetChip.textContent).includes(expectedSheetTitle);
        } else {
          sheetMatches = !!(sheetLink || sheetChip || continueBtn);
        }

        // Check 3: Draft ID match
        let draftIdMatches = true;
        if (draftId && draftId !== 'unknown') {
          draftIdMatches = (actualDraftId === draftId) ||
            (window.location.hash && window.location.hash.includes(draftId)) ||
            (subjectMatches && continueBtn);
        }

        if (subjectMatches && (sheetMatches || continueBtn) && draftIdMatches) {
          let score = 0;
          if (actualDraftId && draftId && actualDraftId === draftId) score += 30;
          if (window.location.hash && draftId && window.location.hash.includes(draftId)) score += 25;
          if (actualSubject && expectedSubject && actualSubject === expectedSubject) score += 20;
          if (sheetMatches) score += 10;
          if (continueBtn) score += 15;
          candidates.push({ dialog: d, score });
        }
      }

      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].dialog;
    }

    /**
     * Finds matching compose dialog. If it is minimized in the dock, automatically restores/expands it.
     * @param {string} draftId
     * @param {Object} campaign
     * @param {Element|Document} [doc]
     * @returns {Promise<Element|null>}
     */
    static async findAndExpandMatchingComposeDialog(draftId, campaign, doc = document) {
      let dialog = GmailAutomator.findStrictMatchingComposeDialog(draftId, campaign, doc);
      if (!dialog) {
        // Check for minimized compose window by subject in titlebar
        dialog = GmailAutomator.findMinimizedMatchingComposeDialog(draftId, campaign, doc);
      }
      if (dialog) {
        await GmailAutomator.ensureComposeExpanded(dialog);
      }
      return dialog;
    }

    /**
     * Locates a compose dialog that is currently minimized in the bottom dock
     * @param {string} draftId
     * @param {Object} campaign
     * @param {Element|Document} [doc]
     * @returns {Element|null}
     */
    static findMinimizedMatchingComposeDialog(draftId, campaign, doc = document) {
      const dialogs = doc.querySelectorAll('div[role="dialog"], div.M9, div.AD');
      const expectedSubject = normalizeText(campaign?.subject);
      const isGenericSubject = !expectedSubject || expectedSubject.startsWith('mail merge (');

      for (const d of dialogs) {
        if (!d || !d.isConnected) continue;
        const rect = d.getBoundingClientRect();
        if (rect.width === 0) continue;

        const headerTitle = (d.querySelector('h2, div[role="heading"], div.aaq, div.aAU, div.Hp, span')?.textContent || '').trim();
        const subjectInput = (d.querySelector('input[name="subjectbox"], input[aria-label="Subject"]')?.value || '').trim();
        const actualDraftId = d.querySelector('input[name="draft"]')?.value || d.getAttribute('data-compose-id');

        const actualSubject = normalizeText(subjectInput || headerTitle);
        if (!isGenericSubject && actualSubject && expectedSubject) {
          if (actualSubject === expectedSubject ||
              (actualSubject.length > 3 && expectedSubject.includes(actualSubject)) ||
              (expectedSubject.length > 3 && actualSubject.includes(expectedSubject))) {
            return d;
          }
        }

        if (draftId && draftId !== 'unknown' && (actualDraftId === draftId || (window.location.hash && window.location.hash.includes(draftId)))) {
          return d;
        }

        if (isGenericSubject) {
          const hasContinue = Array.from(d.querySelectorAll('button, div[role="button"]')).some((b) => /^(Continue|Send all)$/i.test((b.textContent || '').trim()));
          if (hasContinue) return d;
        }
      }
      return null;
    }

    /**
     * Expands a compose window if it is minimized (collapsed to ~35-45px height)
     * @param {Element} dialog
     * @returns {Promise<boolean>} True if it was minimized and expanded
     */
    static async ensureComposeExpanded(dialog) {
      if (!dialog || !dialog.isConnected) return false;

      const rect = dialog.getBoundingClientRect();
      const bodyEl = dialog.querySelector('[aria-label="Message Body"]');
      const isBodyHidden = !bodyEl || !isElementVisible(bodyEl);
      const isHeightCollapsed = rect.height > 0 && rect.height < 120;

      if (isHeightCollapsed || isBodyHidden) {
        console.log('[GmailAutomator] 🔍 Compose window is MINIMIZED (height: ' + Math.round(rect.height) + 'px). Expanding...');

        // In Gmail, clicking the titlebar or the expand/maximize button restores the window
        const expandBtn = dialog.querySelector(
          '[aria-label*="Maximize" i], [aria-label*="Full screen" i], [aria-label*="expand" i], img[alt*="Maximize" i]'
        );
        const titleBar = dialog.querySelector('h2, div[role="heading"], div.aaq, div.aAU, div.Hp') || dialog.firstElementChild || dialog;

        if (expandBtn && isElementVisible(expandBtn)) {
          await humanClick(expandBtn);
        } else if (titleBar) {
          await humanClick(titleBar);
        } else {
          await humanClick(dialog);
        }

        await sleep(800);
        console.log('[GmailAutomator] 📏 Compose window restored. New height: ' + Math.round(dialog.getBoundingClientRect().height) + 'px');
        return true;
      }
      return false;
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
      let subject = campaign?.subject;
      currentActiveCampaign = campaign;
      let currentStep = 'NAVIGATE';

      // Launch floating Execution HUD in Gmail
      try {
        ExecutionHUD.show(campaign);
      } catch (_) {}

      // Helper to report live progress to IDB, popup, and in-tab HUD
      const reportProgress = async (step, message, pct) => {
        currentStep = step;
        if (typeof window !== 'undefined') {
          window.__MM_LAST_STEP__ = step;
        }
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

      let composeDialog = null;
      try {
        // Auto-dismiss any Google spam / junk policy disclaimer modal right away
        await dismissGoogleSpamDisclaimerIfNeeded(document);

        await reportProgress('NAVIGATE', 'Locating and verifying targeted draft...', 10);

        // 1. First check if matching compose dialog is ALREADY open or minimized in this tab
        composeDialog = await GmailAutomator.findAndExpandMatchingComposeDialog(draftId, campaign);

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

        // 2. Locate and verify draft across multiple forensic passes
        await reportProgress('LOAD_DRAFT', 'Verifying draft & Mail Merge session...', 30);
        if (!composeDialog) {
          try {
            composeDialog = await waitFor(
              async () => {
                await dismissGoogleSpamDisclaimerIfNeeded(document);
                return await GmailAutomator.findAndExpandMatchingComposeDialog(draftId, campaign);
              },
              { timeout: 10000, errorMsg: 'Target mail merge draft not loaded via URL' }
            );
          } catch (_) {
            await dismissGoogleSpamDisclaimerIfNeeded(document);

            // Pass 4: Search draft rows in Drafts folder list by expected subject
            if (subject) {
              const cleanSub = normalizeText(subject);
              const isGeneric = !cleanSub || cleanSub.startsWith('mail merge (');
              if (!isGeneric) {
                const draftRows = Array.from(document.querySelectorAll('tr[role="row"], div[role="row"]'))
                  .filter((r) => normalizeText(r.textContent || '').includes(cleanSub));

                for (const row of draftRows) {
                  await humanClick(row);
                  await sleep(1500);
                  const dialog = await GmailAutomator.findAndExpandMatchingComposeDialog(draftId, campaign);
                  if (dialog) {
                    composeDialog = dialog;
                    break;
                  }
                }
              }
            }

            // Pass 5: Search draft rows in Drafts folder list by Google Sheet title
            if (!composeDialog && campaign?.sheetTitle) {
              const cleanSheet = normalizeText(campaign.sheetTitle);
              if (cleanSheet) {
                const sheetRows = Array.from(document.querySelectorAll('tr[role="row"], div[role="row"]'))
                  .filter((r) => normalizeText(r.textContent || '').includes(cleanSheet));

                for (const row of sheetRows) {
                  await humanClick(row);
                  await sleep(1500);
                  const dialog = await GmailAutomator.findAndExpandMatchingComposeDialog(draftId, campaign);
                  if (dialog) {
                    composeDialog = dialog;
                    break;
                  }
                }
              }
            }

            // Quick final check if compose dialog opened during clicks
            if (!composeDialog) {
              try {
                composeDialog = await waitFor(
                  async () => {
                    await dismissGoogleSpamDisclaimerIfNeeded(document);
                    return await GmailAutomator.findAndExpandMatchingComposeDialog(draftId, campaign);
                  },
                  { timeout: 3000, errorMsg: 'Not found' }
                );
              } catch (_) {}
            }
          }
        }

        // 100% FORENSIC DIAGNOSIS: If draft is confirmed missing after all passes, diagnose & flag non-retryable
        if (!composeDialog) {
          const userMatch = /\/u\/(\d+)/.exec(window.location.pathname);
          const currentAccountIndex = userMatch ? userMatch[1] : (campaign?.userIndex || '0');

          const openDialogs = Array.from(document.querySelectorAll('div[role="dialog"], div.M9, div.AD'));
          const openTitles = openDialogs.map((d) => {
            const sub = d.querySelector('input[name="subjectbox"], input[aria-label="Subject"]')?.value ||
                        d.querySelector('h2, div[role="heading"], div.aaq, div.aAU, div.Hp, span.aYF')?.textContent || '';
            const dId = d.querySelector('input[name="draft"]')?.value || d.getAttribute('data-compose-id') || '';
            return sub.trim() ? `"${sub.trim()}"${dId ? ` (id: ${dId})` : ''}` : '(empty dialog/modal)';
          }).filter(Boolean);

          const visibleRows = Array.from(document.querySelectorAll('tr[role="row"], div[role="row"]'))
            .slice(0, 6)
            .map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70))
            .filter(Boolean);

          const notFoundErr = new Error(
            `[DRAFT_NOT_FOUND] Missing Draft: Could not locate draft "${subject || 'Campaign'}" (Draft ID: ${draftId || 'none'}) in Gmail account #${currentAccountIndex} (${campaign?.accountEmail || 'active account'}).\n` +
            `Diagnosis: Verified 5 search passes across active compose windows, minimized dock, URL hash (#drafts?compose=${draftId}), and Drafts folder list rows. Draft was not found; it was likely deleted, discarded, or already sent in Gmail.\n` +
            `Forensic Details: URL: ${window.location.href} | Open Dialogs on Screen (${openTitles.length}): [${openTitles.join(', ') || 'none'}] | Visible Draft Rows (${visibleRows.length}): [${visibleRows.join('; ') || 'none'}].\n` +
            `Action: CANNOT AUTO-RETRY. The underlying draft does not exist in Gmail. Please create a new draft or schedule fresh from a template.`
          );
          notFoundErr.category = 'DRAFT_NOT_FOUND';
          notFoundErr.canAutoRetry = false;
          throw notFoundErr;
        }

        // Ensure compose window is completely expanded and restored
        await GmailAutomator.ensureComposeExpanded(composeDialog);

        // Verify Subject with Unicode normalization and generic fallback support
        const verifySubject = (composeDialog.querySelector('input[name="subjectbox"]')?.value ||
          composeDialog.querySelector('h2, div[role="heading"], div.aaq, div.aAU, div.Hp, span.aYF')?.textContent || '').trim();
        const normExpectedSub = normalizeText(subject);
        const normVerifySub = normalizeText(verifySubject);
        const isGenericSub = !normExpectedSub ||
          normExpectedSub.startsWith('mail merge (') ||
          normExpectedSub.includes('compose') ||
          normExpectedSub.includes('new message');

        if (!isGenericSub && normVerifySub && !normVerifySub.includes(normExpectedSub) && !normExpectedSub.includes(normVerifySub)) {
          throw new Error(`Subject Mismatch: Compose window subject "${verifySubject}" does not match campaign subject "${subject}".`);
        }

        // Auto-heal legacy campaigns with generic subject placeholders
        if (isGenericSub && verifySubject && !/^(compose:?\s*)?new message$/i.test(verifySubject) && campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, { subject: verifySubject }).catch(() => {});
          console.log(`[GmailAutomator] 🔄 Auto-updated legacy campaign subject from "${subject}" to "${verifySubject}".`);
          subject = verifySubject;
          if (campaign) campaign.subject = verifySubject;
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
            const buttons = composeDialog.querySelectorAll('button, div[role="button"], [role="button"].continue, button.continue, .T-I-KE');
            for (const btn of buttons) {
              const txt = (btn.textContent || '').trim();
              const aria = btn.getAttribute('aria-label') || '';
              if (/^Continue$/i.test(txt) || /^Continue$/i.test(aria)) {
                return btn;
              }
            }
            return null;
          },
          async () => {
            // If Google intercepted with an alertdialog or policy modal, auto-accept and dismiss it
            const intercepted = await dismissGoogleSpamDisclaimerIfNeeded(document, campaign);
            if (intercepted) {
              if (campaignId && root.IDBStore) {
                await root.IDBStore.addLog(campaignId, 'INFO', 'Google modal/alert automatically dismissed. Re-triggering "Continue" click...').catch(() => {});
              }
              // Google's modal consumed the previous click! Immediately re-click "Continue"
              await sleep(400);
              const continueBtn = composeDialog.querySelector('button, div[role="button"], [role="button"].continue, button.continue, .T-I-KE');
              if (continueBtn && isElementVisible(continueBtn)) {
                console.log('[GmailAutomator] 🔄 Re-clicking "Continue" after dismissing Google modal/alert...');
                await humanClick(continueBtn);
              }
            }

            const dialogs = document.querySelectorAll('div[role="dialog"], div[role="alertdialog"], div.Kj-JD');
            for (const d of dialogs) {
              const txt = (d.textContent || '').trim();

              // Check for Google Sheet error popup ("Can't open the sheet")
              if (txt.includes("Can't open the sheet") || txt.includes("cannot open the sheet") || txt.includes("try another sheet")) {
                console.warn('[GmailAutomator] ❌ Detected Google "Can\'t open the sheet" error dialog.');
                await captureForensicSnapshot('SHEET_ACCESS_DELAY', d, 'Google reported Can\'t open the sheet', campaign);
                const backBtns = Array.from(d.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], .T-I, .jfk-button, [aria-label*="close" i], [aria-label*="cancel" i]'));
                let backBtn = backBtns.find((b) => /back to draft|close|cancel|ok/i.test((b.textContent || '').trim()));
                if (!backBtn) {
                  backBtn = Array.from(d.querySelectorAll('*')).find((el) => isElementVisible(el) && /back to draft|close|cancel|ok/i.test((el.textContent || '').trim()));
                }
                if (backBtn) {
                  await humanClick(backBtn);
                  try { if (typeof backBtn.click === 'function') backBtn.click(); } catch (_) {}
                  await sleep(400);
                }

                // Check retry count: retry once after 2 minutes for temporary Drive 429 rate limit
                const retryCount = campaign?.sheetRetryCount || 0;
                if (retryCount < 1) {
                  const postponeTime = Date.now() + 2 * 60 * 1000;
                  console.warn(`[GmailAutomator] ⏳ Google Sheet access delay. Auto-retrying in 2 minutes for campaign ${campaignId}...`);
                  if (campaignId && root.IDBStore) {
                    await root.IDBStore.updateCampaign(campaignId, {
                      status: 'QUEUED',
                      scheduledAt: new Date(postponeTime).toISOString(),
                      sheetRetryCount: 1
                    }).catch(() => {});
                    await root.IDBStore.addLog(
                      campaignId,
                      'WARN',
                      'Google reported "Can\'t open the sheet" (temporary Drive rate limit or sync delay). Automatically retrying in 2 minutes.'
                    ).catch(() => {});
                  }
                  if (chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({
                      action: 'RESCHEDULE_CAMPAIGN',
                      campaignId: campaignId,
                      scheduledTime: postponeTime
                    }).catch(() => {});
                  }
                  const postErr = new Error('Google Sheet access delayed. Auto-retrying in 2 minutes.');
                  postErr.isPostponed = true;
                  postErr.isFatal = true;
                  throw postErr;
                }

                const fatalErr = new Error('Google Sheet Access Error: Gmail reported "Can\'t open the sheet" after retry. Please verify Google Sheet permissions for this account in Google Drive, ensure the sheet was not moved or deleted, and complete any "Verify it\'s you" security prompts in Chrome.');
                fatalErr.isFatal = true;
                throw fatalErr;
              }

              if (txt.includes('Ready to send') || /send all/i.test(txt)) {
                return d;
              }
            }
            return null;
          },
          { maxRetries: 4, actionName: 'Click "Continue"', retryDelay: 2500, timeoutPerAttempt: 7000 }
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

        // Pre-check: Check if Google disabled "Send all" due to daily sending quota limits
        const modalTextCheck = (modal.textContent || '').toLowerCase();
        if (
          modalTextCheck.includes('exceeds your daily sending limit') ||
          modalTextCheck.includes('reached your daily sending limit') ||
          modalTextCheck.includes('reached your limit for sending') ||
          modalTextCheck.includes('exceeded your sending limit')
        ) {
          const quotaErr = new Error('Google Daily Sending Limit Exceeded: Google Mail Merge disabled "Send all" because this campaign exceeds your remaining 24-hour quota.');
          quotaErr.isQuotaLimit = true;
          quotaErr.isFatal = true;
          throw quotaErr;
        }

        // 5. Click "Send all" with state verification and up to 3 retries
        await reportProgress('SEND_ALL', 'Clicking Send all...', 95);
        await captureForensicSnapshot(
          'READY_TO_SEND',
          modal,
          `Ready to send modal confirmed with ${liveRecipientCount} recipients.`,
          campaign
        );
        await robustClick(
          () => {
            const buttons = modal.querySelectorAll('button, [role="button"], span[role="button"], div[role="button"], [data-tooltip*="Send all" i], [aria-label*="Send all" i], .T-I');
            for (const btn of buttons) {
              const txt = (btn.textContent || '').trim();
              const tooltip = btn.getAttribute('data-tooltip') || btn.getAttribute('aria-label') || '';
              if (/send all/i.test(txt) || /send all/i.test(tooltip)) {
                return btn;
              }
            }
            return Array.from(modal.querySelectorAll('*')).find((el) => isElementVisible(el) && /^send all$/i.test((el.textContent || '').trim())) || null;
          },
          () => {
            // Target state: Modal closed or Gmail confirmation alert
            const modalGone = !modal.isConnected || !isElementVisible(modal);
            const sendingAlert = !!document.querySelector('.vh, [role="alert"], div[aria-live="assertive"]');
            return modalGone || sendingAlert;
          },
          { maxRetries: 3, actionName: 'Click "Send all"', retryDelay: 1200, timeoutPerAttempt: 3000 }
        );

        // 5-Second Active Post-Send Watchdog Window:
        // Actively watch for Google red alert box ("multi-modal limit exceeded", daily sending limit, etc.)
        await reportProgress('VERIFYING_DISPATCH', 'Verifying Gmail acceptance (watching for quota/limit alerts)...', 98);
        const watchdogStart = Date.now();
        const WATCHDOG_DURATION = 5000;
        let quotaAlertFound = null;

        while (Date.now() - watchdogStart < WATCHDOG_DURATION) {
          const alert = detectGoogleQuotaOrLimitAlert();
          if (alert) {
            quotaAlertFound = alert;
            break;
          }
          await sleep(300);
        }

        if (quotaAlertFound) {
          const quotaErrMsg = `Google Multi-Modal / Daily Sending Limit Exceeded: "${quotaAlertFound.message.slice(0, 160)}"`;
          const quotaErr = new Error(quotaErrMsg);
          quotaErr.isQuotaLimit = true;
          quotaErr.category = 'QUOTA_EXCEEDED';
          quotaErr.alertElement = quotaAlertFound.element;
          throw quotaErr;
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

        // 7. Arm 15-Second Retroactive Quota Guard for slow network server rejections
        startRetroactiveQuotaGuard(campaignId, campaign, liveRecipientCount);

        return { success: true, campaignId, sentCount: liveRecipientCount };
      } catch (error) {
        if (error && error.isPostponed) {
          console.warn('[GmailAutomator] ⏳ Campaign execution postponed:', error.message);
          try { ExecutionHUD.remove(); } catch (_) {}
          return { success: false, postponed: true, message: error.message };
        }

        console.error('[GmailAutomator] ❌ Error executing scheduled native merge:', error);
        try {
          ExecutionHUD.error(error.message, currentStep);
        } catch (_) {}

        // 1. Capture lightweight DOM Autopsy (~2 KB JSON snapshot of exact DOM, buttons, hash, alerts)
        let domAutopsy = null;
        try {
          domAutopsy = captureFailureContext(currentStep);
          if (typeof window !== 'undefined') {
            window.__MM_LAST_STEP__ = null;
          }
        } catch (e) {
          console.warn('[GmailAutomator] DOM autopsy capture warning:', e);
        }

        // 2. Capture visual snapshot of the screen at the moment of failure (Screenshots preserved!)
        const alertOrModal = error?.alertElement || document.querySelector('div[role="dialog"], div[role="alertdialog"], div.Kj-JD, div.AD, .vh, [role="alert"], .bBe') || document.body;
        await captureForensicSnapshot(
          error?.isQuotaLimit ? 'QUOTA_LIMIT_EXCEEDED' : 'EXECUTION_FAILED',
          alertOrModal,
          error.message,
          campaign
        );

        // 3. SMART DOM RESET: Clean up lingering alertdialogs and close corrupted compose modal
        // so retry attempts or subsequent campaigns start from a fresh, unobstructed DOM.
        if (!error?.isFatal && !error?.isQuotaLimit && error?.category !== 'DRAFT_NOT_FOUND') {
          try {
            const alertdialogs = Array.from(document.querySelectorAll('div[role="alertdialog"], div.Kj-JD'));
            for (const ad of alertdialogs) {
              if (!isElementVisible(ad)) continue;
              const okBtn = ad.querySelector('button, [role="button"], .T-I, [aria-label*="OK" i], [aria-label*="Dismiss" i], [aria-label*="Close" i]');
              if (okBtn) {
                try { okBtn.click(); } catch (_) {}
              }
            }
            if (composeDialog && composeDialog.isConnected) {
              const closeBtn = composeDialog.querySelector('img[aria-label*="Save & close" i], div[aria-label*="Save & close" i], button[aria-label*="Close" i], [aria-label*="Close" i], img.Ha, div.Ha');
              if (closeBtn) {
                try { closeBtn.click(); } catch (_) {}
                console.log('[GmailAutomator] 🚪 Closed stuck compose dialog to ensure clean slate for retry.');
              }
            }
            await sleep(1000);
          } catch (cleanErr) {
            console.warn('[GmailAutomator] Tab DOM cleanup warning:', cleanErr);
          }
        }

        const isQuota = !!error?.isQuotaLimit || (error?.category === 'QUOTA_EXCEEDED');
        const isDraftNotFound = (error && (error.category === 'DRAFT_NOT_FOUND' || (error.message && error.message.includes('[DRAFT_NOT_FOUND]'))));
        const errorCategory = isQuota ? 'QUOTA_EXCEEDED' : (error?.category || (isDraftNotFound ? 'DRAFT_NOT_FOUND' : 'EXECUTION_ERROR'));
        const canAutoRetry = isQuota ? false : (error?.canAutoRetry !== undefined ? error.canAutoRetry : !isDraftNotFound);

        if (campaignId && root.IDBStore) {
          await root.IDBStore.updateCampaign(campaignId, {
            status: 'FAILED',
            errorMessage: error.message,
            errorCategory: errorCategory,
            canAutoRetry: canAutoRetry,
            failedAt: new Date().toISOString(),
            domAutopsy: domAutopsy
          }).catch(() => {});
          await root.IDBStore.addLog(campaignId, 'ERROR', 'Scheduled dispatch failed: ' + error.message).catch(() => {});
        }

        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'CAMPAIGN_STATUS_UPDATE',
            campaignId,
            status: 'FAILED',
            logMessage: error.message,
            errorCategory: errorCategory,
            canAutoRetry: canAutoRetry,
            isQuotaLimit: isQuota,
            accountEmail: campaign?.accountEmail || campaign?.senderEmail,
            domAutopsy: domAutopsy
          }).catch(() => {});
        }

        throw error;
      } finally {
        currentActiveCampaign = null;
      }
    }
  }

  // Expose globally
  root.GmailAutomator = GmailAutomator;
  if (typeof window !== 'undefined') {
    window.GmailAutomator = GmailAutomator;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
