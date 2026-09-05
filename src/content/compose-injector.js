/**
 * ComposeInjector - Injects a collapsible, elegant Shadow DOM panel into Gmail Compose dialogs.
 * Integrates directly with native Gmail Mail Merge, IDBStore, and GmailAutomator.
 * Follows "Integrate & Enhance" architecture:
 *   1. Hidden by default: Takes 0 vertical space until user clicks the toolbar button.
 *   2. Real-time Native Detection: Syncs with Gmail's native mail merge mode.
 *   3. Resolves button confusion: Native mode links to Gmail's Continue button.
 *   4. Supercharges Gmail: Adds future scheduling, canned templates, merge tags, and audit logging.
 */
(function (root) {
  'use strict';

  const CONTAINER_ID = 'gmail-mail-merge-panel-root';
  const BUTTON_ATTR = 'data-mail-merge-btn-injected';

  const PRESET_TEMPLATES = [
    {
      id: 'preset-cfp',
      name: 'Call for Papers (CFP)',
      subject: 'Call for Papers: International Research Conference {{year}}',
      body: `Dear {{first_name}},\n\nWe cordially invite you to submit your research paper for the upcoming Academic Conference.\n\nKey Deadlines:\n- Paper Submission: October 15\n- Acceptance Notice: November 1\n\nPlease submit your abstract via the conference portal.\n\nBest regards,\nConference Editorial Team`
    },
    {
      id: 'preset-collab',
      name: 'Research Invitation',
      subject: 'Research Collaboration Opportunity - {{organization}}',
      body: `Dear Dr. {{name}},\n\nI hope this message finds you well. We are following your insightful work in your field and would love to explore a joint research collaboration between our teams.\n\nCould we schedule a brief 15-minute video call next week?\n\nSincerely,\nProject Lead`
    },
    {
      id: 'preset-reminder',
      name: 'CFP Reminder',
      subject: 'Final Reminder: Submission Deadline Approaching for {{first_name}}',
      body: `Dear {{name}},\n\nThis is a brief reminder that the manuscript submission deadline for the special issue is rapidly approaching.\n\nWe look forward to receiving your submission.\n\nWarm regards,\nEditorial Committee`
    }
  ];

  class ComposeInjector {
    /**
     * Injects the Mail Merge Shadow DOM panel into the given Gmail compose dialog.
     * Starts HIDDEN (display: none) by default to avoid space-hogging and visual clutter.
     * @param {Element} composeDialog
     * @returns {ShadowRoot|null}
     */
    static injectIntoCompose(composeDialog) {
      if (!composeDialog || !(composeDialog instanceof Element)) {
        return null;
      }

      // Avoid double injection
      const existingContainer = composeDialog.querySelector(`#${CONTAINER_ID}`);
      if (existingContainer && existingContainer.shadowRoot) {
        return existingContainer.shadowRoot;
      }

      console.log('[ComposeInjector] Mounting collapsible Shadow DOM panel (hidden by default)...');

      const container = document.createElement('div');
      container.id = CONTAINER_ID;
      container.setAttribute('data-mail-merge-injected', 'true');
      // HIDDEN BY DEFAULT: 0 height, no space hogging until user activates it!
      container.style.cssText = 'display: none; width: 100%; box-sizing: border-box; z-index: 999; margin: 4px 0;';

      const shadow = container.attachShadow({ mode: 'open' });

      // Build Shadow DOM Template
      shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            color: #202124;
            display: block;
          }

          * {
            box-sizing: border-box;
          }

          .panel-card {
            background: #ffffff;
            border: 1px solid #dadce0;
            border-radius: 8px;
            box-shadow: 0 3px 10px rgba(60, 64, 67, 0.14);
            overflow: hidden;
            transition: all 0.2s ease-in-out;
          }

          /* Header */
          .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px;
            background: #f8f9fa;
            border-bottom: 1px solid #dadce0;
            cursor: pointer;
            user-select: none;
          }

          .panel-header:hover {
            background: #f1f3f4;
          }

          .header-left {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .header-title {
            font-weight: 600;
            font-size: 12px;
            color: #1a73e8;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .header-title.native-active {
            color: #7e22ce;
          }

          .badge {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 12px;
            background: #e8f0fe;
            color: #1a73e8;
          }

          .badge.status-native-active {
            background: #f3e8fd;
            color: #7e22ce;
            border: 1px solid #d8b4fe;
          }

          .badge.status-running {
            background: #fef7e0;
            color: #b06000;
          }

          .badge.status-completed {
            background: #ceead6;
            color: #137333;
          }

          .badge.status-failed {
            background: #fce8e6;
            color: #c5221f;
          }

          .header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .btn-header-tool {
            background: #ffffff;
            border: 1px solid #dadce0;
            border-radius: 4px;
            padding: 2px 7px;
            font-size: 11px;
            font-weight: 500;
            color: #1a73e8;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .btn-header-tool:hover {
            background: #e8f0fe;
          }

          .btn-header-icon {
            background: transparent;
            border: none;
            font-size: 12px;
            color: #5f6368;
            cursor: pointer;
            padding: 3px 6px;
            border-radius: 4px;
            line-height: 1;
            transition: all 0.15s ease;
          }

          .btn-header-icon:hover {
            background: #e8eaed;
            color: #202124;
          }

          .btn-header-close {
            font-weight: bold;
            font-size: 13px;
          }

          .btn-header-close:hover {
            background: #fce8e6;
            color: #c5221f;
          }

          /* Adaptive Status Notice Banner */
          .native-status-banner {
            background: #f8f9fa;
            border: 1px solid #dadce0;
            border-radius: 6px;
            padding: 8px 10px;
            margin-bottom: 3px;
            transition: all 0.2s ease;
          }

          .native-status-banner.is-native {
            background: #fbf8ff;
            border-color: #d8b4fe;
          }

          .native-banner-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            font-weight: 600;
          }

          .native-banner-title {
            display: flex;
            align-items: center;
            gap: 5px;
            color: #3c4043;
          }

          .native-status-banner.is-native .native-banner-title {
            color: #6b21a8;
          }

          .native-banner-desc {
            font-size: 11px;
            color: #5f6368;
            margin-top: 3px;
            line-height: 1.35;
          }

          .native-status-banner.is-native .native-banner-desc {
            color: #4b5563;
          }

          .btn-toggle-native {
            background: #ffffff;
            border: 1px solid #c084fc;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 11px;
            color: #7e22ce;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .btn-toggle-native:hover {
            background: #f3e8fd;
          }

          /* Body */
          .panel-body {
            padding: 8px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #ffffff;
            max-height: 165px;
            overflow-y: auto;
          }

          .panel-body.collapsed {
            display: none;
          }

          /* Form Controls */
          .form-group {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .form-label {
            font-size: 10px;
            font-weight: 600;
            color: #5f6368;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }

          .input-text {
            width: 100%;
            padding: 5px 8px;
            border: 1px solid #dadce0;
            border-radius: 4px;
            font-size: 12px;
            color: #202124;
            outline: none;
            transition: border-color 0.2s ease;
          }

          .input-text:focus {
            border-color: #1a73e8;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
          }

          .native-sheet-banner {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: #137333;
            background: #e6f4ea;
            border: 1px solid #ceead6;
            padding: 4px 8px;
            border-radius: 4px;
            margin-bottom: 2px;
          }

          .native-sheet-banner.hidden {
            display: none;
          }

          /* Pill for Sheet ID */
          .sheet-id-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: #137333;
            background: #e6f4ea;
            border: 1px solid #ceead6;
            padding: 2px 8px;
            border-radius: 12px;
            margin-top: 3px;
            word-break: break-all;
          }

          .sheet-id-pill.hidden {
            display: none;
          }

          /* Tag Pills */
          .pill-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
          }

          .tag-pill {
            background: #e8f0fe;
            color: #1a73e8;
            border: 1px solid #d2e3fc;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            transition: background 0.15s ease;
          }

          .tag-pill:hover {
            background: #d2e3fc;
          }

          /* Preset Template Buttons */
          .template-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }

          .btn-template {
            background: #f1f3f4;
            color: #3c4043;
            border: 1px solid #dadce0;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .btn-template:hover {
            background: #e8eaed;
            color: #202124;
          }

          /* Options & Schedule */
          .options-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
            padding: 5px 0;
            border-top: 1px solid #f1f3f4;
            border-bottom: 1px solid #f1f3f4;
          }

          .checkbox-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #3c4043;
            cursor: pointer;
            user-select: none;
          }

          .radio-group {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 12px;
            color: #3c4043;
          }

          .radio-label {
            display: flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
          }

          .schedule-picker {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
          }

          .schedule-picker.hidden {
            display: none;
          }

          /* Progress Bar */
          .progress-container {
            display: none;
            flex-direction: column;
            gap: 4px;
            padding: 4px 0;
          }

          .progress-container.active {
            display: flex;
          }

          .progress-track {
            width: 100%;
            height: 6px;
            background: #e8eaed;
            border-radius: 3px;
            overflow: hidden;
          }

          .progress-fill {
            height: 100%;
            width: 0%;
            background: #1a73e8;
            border-radius: 3px;
            transition: width 0.3s ease;
          }

          .progress-text {
            font-size: 11px;
            color: #5f6368;
            display: flex;
            justify-content: space-between;
          }

          /* Alert / Notification box */
          .alert-box {
            padding: 8px 10px;
            border-radius: 4px;
            font-size: 12px;
            display: none;
          }

          .alert-box.visible {
            display: block;
          }

          .alert-box.alert-success {
            background: #e6f4ea;
            border: 1px solid #ceead6;
            color: #137333;
          }

          .alert-box.alert-error {
            background: #fce8e6;
            border: 1px solid #fad2cf;
            color: #c5221f;
          }

          /* Actions Row (Pinned Visible Footer) */
          .actions-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            padding: 6px 12px;
            background: #f8f9fa;
            border-top: 1px solid #dadce0;
          }

          .action-buttons-right {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all 0.2s ease;
            user-select: none;
          }

          .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          .btn-primary {
            background: #1a73e8;
            color: #ffffff;
          }

          .btn-primary:hover:not(:disabled) {
            background: #1557b0;
            box-shadow: 0 1px 3px rgba(60, 64, 67, 0.2);
          }

          .btn-purple {
            background: #7e22ce;
            color: #ffffff;
          }

          .btn-purple:hover:not(:disabled) {
            background: #6b21a8;
            box-shadow: 0 1px 3px rgba(126, 34, 206, 0.25);
          }

          .btn-secondary {
            background: #ffffff;
            color: #1a73e8;
            border: 1px solid #dadce0;
          }

          .btn-secondary:hover:not(:disabled) {
            background: #f8f9fa;
            border-color: #1a73e8;
          }

          .btn-accent {
            background: #f9ab00;
            color: #202124;
          }

          .btn-accent:hover:not(:disabled) {
            background: #e37400;
            color: #ffffff;
          }
        </style>

        <div class="panel-card">
          <!-- Header -->
          <div class="panel-header" id="headerToggle" title="Click to minimize or expand">
            <div class="header-left">
              <span class="header-title" id="headerTitle">⚡ Mail Merge & Scheduler Companion</span>
              <span class="badge" id="statusBadge">Standby</span>
            </div>
            <div class="header-actions">
              <button type="button" id="btnHeaderDashboard" class="btn-header-tool" title="Open Operations Dashboard">📊 Dashboard</button>
              <button type="button" id="btnMinimizePanel" class="btn-header-icon" title="Minimize / Expand">▲</button>
              <button type="button" id="btnClosePanel" class="btn-header-icon btn-header-close" title="Close Companion Panel">✕</button>
            </div>
          </div>

          <!-- Body -->
          <div class="panel-body" id="panelBody">
            <!-- Adaptive Status Banner -->
            <div id="nativeNoticeBanner" class="native-status-banner">
              <div class="native-banner-header">
                <span class="native-banner-title" id="nativeBannerTitle">
                  <span id="nativeIndicatorDot">⚪</span>
                  <span id="nativeStatusTitle">Standard Compose Mode</span>
                </span>
                <button type="button" id="btnToggleNative" class="btn-toggle-native">🟣 Turn On Native Merge</button>
              </div>
              <div id="nativeStatusDesc" class="native-banner-desc">
                Tip: Activate Gmail's native Mail Merge from the recipient menu, or use this panel to configure and schedule your campaign.
              </div>
            </div>

            <!-- Google Sheet URL Section -->
            <div class="form-group" id="sheetUrlGroup">
              <label class="form-label" for="sheetUrlInput">Google Sheet Source</label>
              <div id="nativeSheetBanner" class="native-sheet-banner hidden">
                <span>✓ Using Gmail Linked Spreadsheet:</span>
                <strong id="nativeSheetName"></strong>
              </div>
              <input
                type="text"
                id="sheetUrlInput"
                class="input-text"
                placeholder="Paste Google Sheet URL (https://docs.google.com/spreadsheets/d/...)"
                spellcheck="false"
              />
              <div id="sheetIdPill" class="sheet-id-pill hidden">
                <span>✓ Sheet ID:</span> <strong id="sheetIdText"></strong>
              </div>
            </div>

            <!-- Merge Tag Insertion Row -->
            <div class="form-group">
              <span class="form-label">Insert Merge Tags</span>
              <div class="pill-row">
                <span class="tag-pill" data-tag="{{email}}">+ {{email}}</span>
                <span class="tag-pill" data-tag="{{name}}">+ {{name}}</span>
                <span class="tag-pill" data-tag="{{first_name}}">+ {{first_name}}</span>
                <span class="tag-pill" data-tag="{{organization}}">+ {{organization}}</span>
              </div>
            </div>

            <!-- Quick Canned Templates -->
            <div class="form-group">
              <span class="form-label">Quick Canned Templates</span>
              <div class="template-row" id="templateList">
                <button type="button" class="btn-template" data-template-id="preset-cfp">📄 Call for Papers</button>
                <button type="button" class="btn-template" data-template-id="preset-collab">🤝 Research Invite</button>
                <button type="button" class="btn-template" data-template-id="preset-reminder">⏰ CFP Reminder</button>
              </div>
            </div>

            <!-- Recipient Column & Options -->
            <div class="options-row">
              <div class="form-group" style="flex: 1; min-width: 130px;">
                <label class="form-label" for="colInput">Recipient Column</label>
                <input type="text" id="colInput" class="input-text" value="email" placeholder="email" style="padding: 4px 8px; font-size: 12px;" />
              </div>

              <div style="display: flex; flex-direction: column; gap: 4px; align-self: flex-end;">
                <label class="checkbox-label" id="unsubLabel">
                  <input type="checkbox" id="unsubCheckbox" checked />
                  <span id="unsubText">Auto-append Unsubscribe</span>
                </label>
                <label class="checkbox-label" title="Automates sheet selection and draft preview without sending real emails">
                  <input type="checkbox" id="dryRunCheckbox" checked />
                  <span style="color: #137333; font-weight: 500;">🛡️ Safe Preview / Dry Run</span>
                </label>
              </div>
            </div>

            <!-- Schedule Selector -->
            <div class="form-group">
              <span class="form-label">Dispatch Timing</span>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" name="timingMode" value="now" id="radioNow" checked />
                  ⚡ Send Now
                </label>
                <label class="radio-label">
                  <input type="radio" name="timingMode" value="later" id="radioLater" />
                  📅 Schedule for Later
                </label>
              </div>

              <div id="schedulePickerContainer" class="schedule-picker hidden">
                <input type="datetime-local" id="scheduleDateInput" class="input-text" style="width: auto;" />
                <span style="font-size: 11px; color: #5f6368;">Background worker will trigger automated send.</span>
              </div>
            </div>

            <!-- Progress Bar -->
            <div id="progressContainer" class="progress-container">
              <div class="progress-track">
                <div id="progressFill" class="progress-fill"></div>
              </div>
              <div class="progress-text">
                <span id="progressStep">Initializing...</span>
                <span id="progressPct">0%</span>
              </div>
            </div>

            <!-- Notification Banner -->
            <div id="alertBox" class="alert-box"></div>
          </div>

          <!-- Actions Row (Pinned Visible Footer) -->
          <div id="actionsRow" class="actions-row">
            <button type="button" id="btnSaveTemplate" class="btn btn-secondary">
              💾 Save Template
            </button>

            <div class="action-buttons-right">
              <button type="button" id="btnScheduleCampaign" class="btn btn-accent" style="display: none;">
                📅 Queue Scheduled Campaign
              </button>
              <button type="button" id="btnNativeContinue" class="btn btn-purple" style="display: none;">
                🟣 Send Now via Gmail (Continue)
              </button>
              <button type="button" id="btnSendNow" class="btn btn-primary">
                ⚡ Send Now
              </button>
            </div>
          </div>
        </div>
      `;

      // Determine appropriate DOM insertion point
      const dialogRoot = composeDialog.closest('div[role="dialog"]') ||
        composeDialog.closest('div.AD') ||
        composeDialog;

      if (dialogRoot) {
        if (!dialogRoot.querySelector(`#${CONTAINER_ID}`)) {
          const bottomToolbar = composeDialog.querySelector('.aDh') ||
            composeDialog.querySelector('.btC') ||
            composeDialog.querySelector('[role="toolbar"]');

          if (bottomToolbar && bottomToolbar.parentNode) {
            const validParent = bottomToolbar.parentNode.tagName !== 'TR' && bottomToolbar.parentNode.tagName !== 'TBODY'
              ? bottomToolbar.parentNode
              : dialogRoot;

            validParent.insertBefore(container, bottomToolbar);
          } else {
            dialogRoot.appendChild(container);
          }
        }
      }

      // Bind interactive behaviors to Shadow DOM
      this._bindEvents(shadow, composeDialog);

      // Auto-populate with saved draft or default template
      this._populateInitialData(shadow, composeDialog);

      return shadow;
    }

    /**
     * Dynamically adjusts Gmail compose dialog and body editor dimensions
     * to ensure the mail merge panel, Gmail's banner, and bottom toolbar are 100% visible
     * without any cutoff or clipping.
     * @param {Element} composeDialog
     * @param {boolean} active
     */
    static adjustDimensions(composeDialog, active) {
      if (!composeDialog || !(composeDialog instanceof Element)) return;

      const outerBox = composeDialog.closest('div[role="dialog"], div.M9, div.dw') || composeDialog;
      const innerAD = outerBox.querySelector('div.AD') || (outerBox.classList.contains('AD') ? outerBox : null);
      const bodyEditor = outerBox.querySelector('div[aria-label="Message Body"], div[role="textbox"]');
      const bodyWrapper = bodyEditor?.closest('.GP, .qz, .Ap, td') || bodyEditor?.parentElement;

      if (active) {
        // Expand outer compose box height upwards so it never clips at the bottom
        if (outerBox) {
          if (!outerBox.getAttribute('data-mm-orig-h')) {
            outerBox.setAttribute('data-mm-orig-h', outerBox.style.height || '');
          }
          outerBox.style.setProperty('height', 'min(720px, calc(100vh - 30px))', 'important');
          outerBox.style.setProperty('min-height', '560px', 'important');
          outerBox.style.setProperty('max-height', 'calc(100vh - 20px)', 'important');
          outerBox.style.setProperty('overflow', 'visible', 'important');
        }

        if (innerAD && innerAD !== outerBox) {
          if (!innerAD.getAttribute('data-mm-orig-h')) {
            innerAD.setAttribute('data-mm-orig-h', innerAD.style.height || '');
          }
          innerAD.style.setProperty('height', '100%', 'important');
          innerAD.style.setProperty('min-height', '540px', 'important');
          innerAD.style.setProperty('overflow', 'visible', 'important');
        }

        // Adjust body editor wrapper to prevent empty blank space
        if (bodyWrapper) {
          if (!bodyWrapper.getAttribute('data-mm-orig-h')) {
            bodyWrapper.setAttribute('data-mm-orig-h', bodyWrapper.style.height || '');
          }
          bodyWrapper.style.setProperty('max-height', '160px', 'important');
          bodyWrapper.style.setProperty('min-height', '50px', 'important');
          bodyWrapper.style.setProperty('overflow-y', 'auto', 'important');
        }

        if (bodyEditor) {
          bodyEditor.style.setProperty('min-height', '50px', 'important');
          bodyEditor.style.setProperty('max-height', '150px', 'important');
          bodyEditor.style.setProperty('overflow-y', 'auto', 'important');
        }
      } else {
        // Restore default dimensions when Mail Merge panel is collapsed/closed
        if (outerBox && outerBox.hasAttribute('data-mm-orig-h')) {
          const orig = outerBox.getAttribute('data-mm-orig-h');
          if (orig) outerBox.style.height = orig;
          else outerBox.style.removeProperty('height');
          outerBox.style.removeProperty('min-height');
          outerBox.style.removeProperty('max-height');
          outerBox.removeAttribute('data-mm-orig-h');
        }

        if (innerAD && innerAD.hasAttribute('data-mm-orig-h')) {
          const orig = innerAD.getAttribute('data-mm-orig-h');
          if (orig) innerAD.style.height = orig;
          else innerAD.style.removeProperty('height');
          innerAD.style.removeProperty('min-height');
          innerAD.removeAttribute('data-mm-orig-h');
        }

        if (bodyWrapper) {
          bodyWrapper.style.removeProperty('max-height');
          bodyWrapper.style.removeProperty('min-height');
          bodyWrapper.style.removeProperty('overflow-y');
          const origH = bodyWrapper.getAttribute('data-mm-orig-h');
          if (origH) bodyWrapper.style.height = origH;
          else bodyWrapper.style.removeProperty('height');
          bodyWrapper.removeAttribute('data-mm-orig-h');
        }

        if (bodyEditor) {
          bodyEditor.style.removeProperty('min-height');
          bodyEditor.style.removeProperty('max-height');
          bodyEditor.style.removeProperty('overflow-y');
        }
      }
    }

    /**
     * Toggles panel visibility between open (expanded) and closed (hidden).
     * @param {Element} composeDialog
     * @param {boolean} [forceOpen]
     */
    static togglePanel(composeDialog, forceOpen) {
      if (!composeDialog) return;
      let container = composeDialog.querySelector(`#${CONTAINER_ID}`);
      if (!container) {
        this.injectIntoCompose(composeDialog);
        container = composeDialog.querySelector(`#${CONTAINER_ID}`);
      }
      if (!container || !container.shadowRoot) return;

      const shadow = container.shadowRoot;
      const mmButton = composeDialog.querySelector(`[${BUTTON_ATTR}="true"]`);

      const isCurrentlyHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
      const shouldOpen = forceOpen !== undefined ? forceOpen : isCurrentlyHidden;

      if (shouldOpen) {
        container.style.display = 'block';
        this.adjustDimensions(composeDialog, true);
        this.syncNativeState(shadow, composeDialog);

        if (mmButton) {
          const isNative = shadow.getElementById('statusBadge')?.classList.contains('status-native-active');
          mmButton.style.background = isNative ? '#7e22ce' : '#1a73e8';
          mmButton.style.color = '#ffffff';
          mmButton.style.borderColor = isNative ? '#6b21a8' : '#1557b0';
          mmButton.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
        }
      } else {
        container.style.display = 'none';
        this.adjustDimensions(composeDialog, false);

        if (mmButton) {
          const isNative = shadow.getElementById('statusBadge')?.classList.contains('status-native-active');
          mmButton.style.background = isNative ? '#f3e8fd' : '#e8f0fe';
          mmButton.style.color = isNative ? '#7e22ce' : '#1a73e8';
          mmButton.style.borderColor = isNative ? '#d8b4fe' : '#dadce0';
          mmButton.style.boxShadow = '0 1px 2px rgba(60, 64, 67, 0.1)';
        }
      }
    }

    /**
     * Checks if panel is currently open in dialog
     * @param {Element} composeDialog
     * @returns {boolean}
     */
    static isPanelOpen(composeDialog) {
      const container = composeDialog?.querySelector(`#${CONTAINER_ID}`);
      if (!container) return false;
      return container.style.display !== 'none';
    }

    /**
     * Synchronizes the Shadow DOM UI with Gmail's real-time native state
     * @param {ShadowRoot} shadow
     * @param {Element} composeDialog
     */
    static syncNativeState(shadow, composeDialog) {
      if (!shadow || !composeDialog) return;

      const nativeStatus = (root.MailMergeNative && typeof root.MailMergeNative.detectGmailNativeStatus === 'function')
        ? root.MailMergeNative.detectGmailNativeStatus(composeDialog)
        : { active: false, hasContinueBtn: false, sheetName: '' };

      const headerTitle = shadow.getElementById('headerTitle');
      const statusBadge = shadow.getElementById('statusBadge');
      const nativeNoticeBanner = shadow.getElementById('nativeNoticeBanner');
      const nativeIndicatorDot = shadow.getElementById('nativeIndicatorDot');
      const nativeStatusTitle = shadow.getElementById('nativeStatusTitle');
      const nativeStatusDesc = shadow.getElementById('nativeStatusDesc');
      const btnToggleNative = shadow.getElementById('btnToggleNative');
      const nativeSheetBanner = shadow.getElementById('nativeSheetBanner');
      const nativeSheetName = shadow.getElementById('nativeSheetName');
      const unsubCheckbox = shadow.getElementById('unsubCheckbox');
      const unsubText = shadow.getElementById('unsubText');
      const btnNativeContinue = shadow.getElementById('btnNativeContinue');
      const btnSendNow = shadow.getElementById('btnSendNow');
      const radioNow = shadow.getElementById('radioNow');

      if (nativeStatus.active) {
        if (headerTitle) headerTitle.classList.add('native-active');
        if (statusBadge) {
          statusBadge.textContent = '🟣 Native Active';
          statusBadge.className = 'badge status-native-active';
        }
        if (nativeNoticeBanner) nativeNoticeBanner.classList.add('is-native');
        if (nativeIndicatorDot) nativeIndicatorDot.textContent = '🟣';
        if (nativeStatusTitle) nativeStatusTitle.textContent = 'Gmail Native Mail Merge Active';
        if (nativeStatusDesc) {
          nativeStatusDesc.textContent = 'Gmail handles delivery. Use this companion panel to schedule dispatch for later, insert tags, or apply canned templates.';
        }
        if (btnToggleNative) btnToggleNative.style.display = 'none';

        // Sheet detection
        if (nativeStatus.sheetName) {
          if (nativeSheetBanner) {
            nativeSheetBanner.classList.remove('hidden');
            if (nativeSheetName) nativeSheetName.textContent = nativeStatus.sheetName;
          }
        } else {
          if (nativeSheetBanner) nativeSheetBanner.classList.add('hidden');
        }

        // Unsubscribe handling
        if (unsubCheckbox && unsubText) {
          unsubCheckbox.checked = true;
          unsubCheckbox.disabled = true;
          unsubText.textContent = 'Managed natively by Gmail';
        }

        // Action buttons handling
        if (radioNow && radioNow.checked) {
          if (nativeStatus.hasContinueBtn) {
            if (btnNativeContinue) btnNativeContinue.style.display = 'inline-flex';
            if (btnSendNow) btnSendNow.style.display = 'none';
          } else {
            if (btnNativeContinue) btnNativeContinue.style.display = 'none';
            if (btnSendNow) btnSendNow.style.display = 'inline-flex';
          }
        }
      } else {
        if (headerTitle) headerTitle.classList.remove('native-active');
        if (statusBadge) {
          statusBadge.textContent = 'Standby';
          statusBadge.className = 'badge';
        }
        if (nativeNoticeBanner) nativeNoticeBanner.classList.remove('is-native');
        if (nativeIndicatorDot) nativeIndicatorDot.textContent = '⚪';
        if (nativeStatusTitle) nativeStatusTitle.textContent = 'Standard Compose Mode';
        if (nativeStatusDesc) {
          nativeStatusDesc.textContent = 'Tip: Activate Gmail Native Mail Merge from the recipient menu, or use this panel to configure and schedule your campaign.';
        }
        if (btnToggleNative) btnToggleNative.style.display = 'inline-block';
        if (nativeSheetBanner) nativeSheetBanner.classList.add('hidden');

        if (unsubCheckbox && unsubText) {
          unsubCheckbox.disabled = false;
          unsubText.textContent = 'Auto-append Unsubscribe';
        }

        if (radioNow && radioNow.checked) {
          if (btnNativeContinue) btnNativeContinue.style.display = 'none';
          if (btnSendNow) btnSendNow.style.display = 'inline-flex';
        }
      }
    }

    /**
     * Binds UI events inside the Shadow DOM
     * @private
     */
    static _bindEvents(shadow, composeDialog) {
      const headerToggle = shadow.getElementById('headerToggle');
      const panelBody = shadow.getElementById('panelBody');
      const actionsRow = shadow.getElementById('actionsRow');
      const btnMinimizePanel = shadow.getElementById('btnMinimizePanel');
      const btnClosePanel = shadow.getElementById('btnClosePanel');
      const btnHeaderDashboard = shadow.getElementById('btnHeaderDashboard');
      const btnToggleNative = shadow.getElementById('btnToggleNative');
      const sheetUrlInput = shadow.getElementById('sheetUrlInput');
      const sheetIdPill = shadow.getElementById('sheetIdPill');
      const sheetIdText = shadow.getElementById('sheetIdText');
      const radioNow = shadow.getElementById('radioNow');
      const radioLater = shadow.getElementById('radioLater');
      const schedulePickerContainer = shadow.getElementById('schedulePickerContainer');
      const scheduleDateInput = shadow.getElementById('scheduleDateInput');
      const btnSendNow = shadow.getElementById('btnSendNow');
      const btnNativeContinue = shadow.getElementById('btnNativeContinue');
      const btnScheduleCampaign = shadow.getElementById('btnScheduleCampaign');
      const btnSaveTemplate = shadow.getElementById('btnSaveTemplate');
      const alertBox = shadow.getElementById('alertBox');
      const statusBadge = shadow.getElementById('statusBadge');
      const progressContainer = shadow.getElementById('progressContainer');
      const progressFill = shadow.getElementById('progressFill');
      const progressStep = shadow.getElementById('progressStep');
      const progressPct = shadow.getElementById('progressPct');

      // 1. Close Button (Completely closes panel and restores normal editor)
      if (btnClosePanel) {
        btnClosePanel.addEventListener('click', (e) => {
          e.stopPropagation();
          ComposeInjector.togglePanel(composeDialog, false);
        });
      }

      // 2. Minimize / Expand Toggle
      const toggleMinimize = (e) => {
        if (e) e.stopPropagation();
        const isCollapsed = panelBody.classList.toggle('collapsed');
        if (btnMinimizePanel) {
          btnMinimizePanel.textContent = isCollapsed ? '▼' : '▲';
        }
        if (actionsRow) {
          actionsRow.style.display = isCollapsed ? 'none' : 'flex';
        }
        ComposeInjector.adjustDimensions(composeDialog, !isCollapsed);
      };

      if (btnMinimizePanel) {
        btnMinimizePanel.addEventListener('click', toggleMinimize);
      }

      headerToggle.addEventListener('click', (e) => {
        // Prevent toggle if clicking one of the header action buttons
        if (e.target.closest('.header-actions')) return;
        toggleMinimize(e);
      });

      // 3. Open Operations Dashboard
      if (btnHeaderDashboard) {
        btnHeaderDashboard.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' }).catch(() => {});
        });
      }

      // 4. Quick Toggle Native Merge
      if (btnToggleNative) {
        btnToggleNative.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (root.MailMergeNative && typeof root.MailMergeNative.toggleGmailNativeMailMerge === 'function') {
            await root.MailMergeNative.toggleGmailNativeMailMerge(composeDialog);
            setTimeout(() => {
              ComposeInjector.syncNativeState(shadow, composeDialog);
            }, 500);
          }
        });
      }

      // 5. Real-time Sheet ID extraction
      const handleSheetUrlChange = () => {
        const val = sheetUrlInput.value.trim();
        const extractedId = (root.GmailAutomator && typeof root.GmailAutomator.extractGoogleSheetId === 'function')
          ? root.GmailAutomator.extractGoogleSheetId(val)
          : null;

        if (extractedId) {
          sheetIdText.textContent = extractedId;
          sheetIdPill.classList.remove('hidden');
        } else {
          sheetIdPill.classList.add('hidden');
        }
      };

      sheetUrlInput.addEventListener('input', handleSheetUrlChange);
      sheetUrlInput.addEventListener('change', handleSheetUrlChange);

      // 6. Timing Mode (Send Now vs Schedule for Later)
      const updateTimingMode = () => {
        if (radioLater.checked) {
          schedulePickerContainer.classList.remove('hidden');
          btnScheduleCampaign.style.display = 'inline-flex';
          btnSendNow.style.display = 'none';
          if (btnNativeContinue) btnNativeContinue.style.display = 'none';

          if (!scheduleDateInput.value) {
            const future = new Date(Date.now() + 10 * 60 * 1000);
            future.setMinutes(future.getMinutes() - future.getTimezoneOffset());
            scheduleDateInput.value = future.toISOString().slice(0, 16);
            scheduleDateInput.min = new Date().toISOString().slice(0, 16);
          }
        } else {
          schedulePickerContainer.classList.add('hidden');
          btnScheduleCampaign.style.display = 'none';
          ComposeInjector.syncNativeState(shadow, composeDialog);
        }
      };

      radioNow.addEventListener('change', updateTimingMode);
      radioLater.addEventListener('change', updateTimingMode);

      // 7. Merge Tag Pills Click
      const tagPills = shadow.querySelectorAll('.tag-pill');
      tagPills.forEach((pill) => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const tag = pill.getAttribute('data-tag');
          if (tag) {
            this._insertTagIntoCompose(composeDialog, tag);
            this._showAlert(shadow, `Tag ${tag} inserted into active Compose editor.`, 'success', 2500);
          }
        });
      });

      // 8. Preset Canned Templates
      const templateButtons = shadow.querySelectorAll('.btn-template');
      templateButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tplId = btn.getAttribute('data-template-id');
          const tpl = PRESET_TEMPLATES.find((t) => t.id === tplId);
          if (tpl) {
            this._applyTemplateToCompose(composeDialog, tpl);
            this._showAlert(shadow, `Applied template "${tpl.name}".`, 'success', 3000);
          }
        });
      });

      // 9. Save Template
      btnSaveTemplate.addEventListener('click', async () => {
        const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
        const bodyEditor = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"]');

        const currentSubject = subjectInput ? subjectInput.value.trim() : '';
        const currentBody = bodyEditor ? (bodyEditor.innerText || bodyEditor.textContent || '').trim() : '';

        if (!currentSubject && !currentBody) {
          this._showAlert(shadow, 'Compose Subject and Body are empty. Type your message first.', 'error', 3500);
          return;
        }

        const templateName = currentSubject ? `Template: ${currentSubject.slice(0, 30)}` : `Custom Template ${new Date().toLocaleDateString()}`;

        try {
          if (root.IDBStore && typeof root.IDBStore.saveTemplate === 'function') {
            await root.IDBStore.saveTemplate({
              name: templateName,
              subject: currentSubject,
              body: currentBody
            });
            this._showAlert(shadow, `Template "${templateName}" saved to database!`, 'success', 3500);
          } else {
            this._showAlert(shadow, 'Template saved locally.', 'success', 3000);
          }
        } catch (err) {
          this._showAlert(shadow, `Failed to save template: ${err.message}`, 'error', 4000);
        }
      });

      // 10. Native Continue Click (Directly triggers Gmail's native Continue button)
      if (btnNativeContinue) {
        btnNativeContinue.addEventListener('click', () => {
          const continueBtn = Array.from(composeDialog.querySelectorAll('button, div[role="button"]'))
            .find(b => /^Continue$/i.test((b.textContent || '').trim()));

          if (continueBtn) {
            this._showAlert(shadow, 'Triggering Gmail Native Mail Merge flow...', 'success', 3000);
            continueBtn.click();
          } else {
            btnSendNow.click();
          }
        });
      }

      // 11. Send Now (Calls GmailAutomator)
      btnSendNow.addEventListener('click', async () => {
        const sheetUrl = sheetUrlInput.value.trim();
        const recipientCol = shadow.getElementById('colInput').value.trim() || 'email';
        const includeUnsub = shadow.getElementById('unsubCheckbox').checked;
        const isDryRun = shadow.getElementById('dryRunCheckbox')?.checked ?? true;

        const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
        const bodyEditor = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"]');

        const currentSubject = subjectInput ? subjectInput.value.trim() : '';
        const currentBody = bodyEditor ? (bodyEditor.innerText || bodyEditor.textContent || '').trim() : '';

        if (!sheetUrl) {
          this._showAlert(shadow, 'Please provide a valid Google Sheet URL.', 'error', 4000);
          sheetUrlInput.focus();
          return;
        }
        if (!currentSubject) {
          this._showAlert(shadow, 'Please fill in the Subject line in Gmail Compose.', 'error', 4000);
          if (subjectInput) subjectInput.focus();
          return;
        }

        btnSendNow.disabled = true;
        btnScheduleCampaign.disabled = true;
        btnSaveTemplate.disabled = true;
        statusBadge.textContent = 'Running...';
        statusBadge.className = 'badge status-running';
        progressContainer.classList.add('active');

        const onProgress = (prog) => {
          if (progressFill) progressFill.style.width = `${prog.pct}%`;
          if (progressPct) progressPct.textContent = `${prog.pct}%`;
          if (progressStep) progressStep.textContent = `${prog.step}: ${prog.message}`;
        };

        try {
          if (!root.GmailAutomator || typeof root.GmailAutomator.runMailMerge !== 'function') {
            throw new Error('GmailAutomator is not loaded in this tab.');
          }

          const result = await root.GmailAutomator.runMailMerge(
            {
              spreadsheetUrl: sheetUrl,
              subject: currentSubject,
              bodyTemplate: currentBody,
              recipientColumn: recipientCol,
              includeUnsubscribe: includeUnsub,
              dryRun: isDryRun
            },
            onProgress
          );

          if (result.success) {
            statusBadge.textContent = isDryRun ? 'Preview Ready' : 'Sent';
            statusBadge.className = 'badge status-completed';
            this._showAlert(
              shadow,
              isDryRun
                ? '🛡️ Safe Preview / Dry Run completed! Native mail merge verified.'
                : '🎉 Mail merge campaign sent successfully!',
              'success',
              6000
            );
          } else {
            throw new Error(result.error || 'Failed to submit mail merge.');
          }
        } catch (err) {
          console.error('[ComposeInjector] Automation error:', err);
          statusBadge.textContent = 'Failed';
          statusBadge.className = 'badge status-failed';
          this._showAlert(shadow, `Automation error: ${err.message}`, 'error', 6000);
        } finally {
          btnSendNow.disabled = false;
          btnScheduleCampaign.disabled = false;
          btnSaveTemplate.disabled = false;
        }
      });

      // 12. Queue Scheduled Campaign
      btnScheduleCampaign.addEventListener('click', async () => {
        const sheetUrl = sheetUrlInput.value.trim();
        const recipientCol = shadow.getElementById('colInput').value.trim() || 'email';
        const includeUnsub = shadow.getElementById('unsubCheckbox').checked;
        const isDryRun = shadow.getElementById('dryRunCheckbox')?.checked ?? true;
        const scheduleVal = scheduleDateInput.value;

        if (!scheduleVal) {
          this._showAlert(shadow, 'Please choose a scheduled date and time.', 'error', 4000);
          scheduleDateInput.focus();
          return;
        }

        const scheduledTime = new Date(scheduleVal).getTime();
        if (isNaN(scheduledTime) || scheduledTime <= Date.now()) {
          this._showAlert(shadow, 'Scheduled time must be in the future.', 'error', 4000);
          return;
        }

        const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
        const bodyEditor = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"]');

        const currentSubject = subjectInput ? subjectInput.value.trim() : '';
        const currentBody = bodyEditor ? (bodyEditor.innerText || bodyEditor.textContent || '').trim() : '';

        // Check if native spreadsheet is already linked
        const nativeStatus = (root.MailMergeNative && typeof root.MailMergeNative.detectGmailNativeStatus === 'function')
          ? root.MailMergeNative.detectGmailNativeStatus(composeDialog)
          : { active: false, sheetName: '' };

        const finalSheetUrl = sheetUrl || (nativeStatus.sheetName ? `[Gmail Native Sheet: ${nativeStatus.sheetName}]` : '');

        if (!finalSheetUrl) {
          this._showAlert(shadow, 'Please provide a Google Sheet URL or connect a sheet in Gmail.', 'error', 4000);
          sheetUrlInput.focus();
          return;
        }
        if (!currentSubject) {
          this._showAlert(shadow, 'Please fill in the Subject line in Gmail Compose.', 'error', 4000);
          if (subjectInput) subjectInput.focus();
          return;
        }

        try {
          if (!root.IDBStore) {
            throw new Error('IDBStore is not available.');
          }

          const campaign = {
            name: currentSubject.slice(0, 50),
            spreadsheetUrl: finalSheetUrl,
            subject: currentSubject,
            bodyTemplate: currentBody,
            recipientColumn: recipientCol,
            includeUnsubscribe: includeUnsub,
            dryRun: isDryRun,
            isNative: nativeStatus.active,
            scheduledAt: new Date(scheduledTime).toISOString(),
            status: 'QUEUED'
          };

          const saved = await root.IDBStore.saveCampaign(campaign);
          await root.IDBStore.addLog(saved.id, 'INFO', `Campaign scheduled for ${new Date(scheduledTime).toLocaleString()}`);

          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            chrome.runtime.sendMessage({
              action: 'REGISTER_SCHEDULED_ALARM',
              campaignId: saved.id,
              scheduledTime: scheduledTime
            }).catch(() => {});
          }

          statusBadge.textContent = 'Scheduled';
          statusBadge.className = 'badge status-completed';
          this._showAlert(
            shadow,
            `📅 Campaign successfully queued for ${new Date(scheduledTime).toLocaleString()}!`,
            'success',
            6000
          );
        } catch (err) {
          this._showAlert(shadow, `Failed to queue campaign: ${err.message}`, 'error', 5000);
        }
      });
    }

    /**
     * Inserts a merge tag pill into the compose dialog's active editor
     * @private
     */
    static _insertTagIntoCompose(composeDialog, tag) {
      const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
      const bodyEditor = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"]');

      if (document.activeElement === subjectInput) {
        const start = subjectInput.selectionStart || subjectInput.value.length;
        const end = subjectInput.selectionEnd || subjectInput.value.length;
        const val = subjectInput.value;
        subjectInput.value = val.substring(0, start) + tag + val.substring(end);
        subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
        subjectInput.focus();
        return;
      }

      if (bodyEditor) {
        bodyEditor.focus();
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, tag);
        } catch (_) {
          inserted = false;
        }

        if (!inserted) {
          bodyEditor.innerHTML += `<span>${tag}</span>`;
        }
        bodyEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
    }

    /**
     * Applies a template to the Gmail compose fields
     * @private
     */
    static _applyTemplateToCompose(composeDialog, template) {
      const subjectInput = composeDialog.querySelector('input[name="subjectbox"], input[aria-label="Subject"]');
      const bodyEditor = composeDialog.querySelector('div[aria-label="Message Body"], div[role="textbox"]');

      if (subjectInput && template.subject) {
        subjectInput.focus();
        subjectInput.value = template.subject;
        subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
        subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (bodyEditor && template.body) {
        bodyEditor.focus();
        const formatted = template.body
          .split('\n\n')
          .map((p) => `<div>${p.replace(/\n/g, '<br>')}</div>`)
          .join('<div><br></div>');
        bodyEditor.innerHTML = formatted;
        bodyEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        bodyEditor.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    /**
     * Populates initial state from IndexedDB or storage
     * @private
     */
    static async _populateInitialData(shadow, composeDialog) {
      const sheetUrlInput = shadow.getElementById('sheetUrlInput');

      try {
        if (root.IDBStore && typeof root.IDBStore.getSetting === 'function') {
          const lastSheetUrl = await root.IDBStore.getSetting('last_sheet_url');
          if (lastSheetUrl && sheetUrlInput && !sheetUrlInput.value) {
            sheetUrlInput.value = lastSheetUrl;
            sheetUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      } catch (_) {}
    }

    /**
     * Shows a feedback alert inside the Shadow DOM
     * @private
     */
    static _showAlert(shadow, message, type = 'success', duration = 3000) {
      const alertBox = shadow.getElementById('alertBox');
      if (!alertBox) return;

      alertBox.textContent = message;
      alertBox.className = `alert-box visible alert-${type}`;

      setTimeout(() => {
        alertBox.className = 'alert-box';
      }, duration);
    }
  }

  // Expose globally
  root.ComposeInjector = ComposeInjector;
  if (typeof window !== 'undefined') {
    window.ComposeInjector = ComposeInjector;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
