/**
 * ComposeInjector - Lean stub for Gmail Native Mail Merge & Scheduler.
 * In accordance with the "Zero Extra UI" specification (read-from-this.txt):
 * The legacy 40% height companion panel, sidebar, and duplicate compose elements
 * have been completely removed. Compose remains 100% native Gmail.
 */
(function (root) {
  'use strict';

  console.log('[ComposeInjector] Zero-UI Lean Mode active. Heavy compose panels stripped.');

  const ComposeInjector = {
    injectIntoCompose(composeDialog) {
      // Intentionally stripped: zero UI overhead in compose dialog.
      return null;
    },
    isPanelOpen(composeDialog) {
      return false;
    },
    togglePanel(composeDialog) {
      // No-op
    },
    adjustDimensions(composeDialog, isExpanded) {
      // No-op
    }
  };

  root.ComposeInjector = ComposeInjector;
  if (typeof window !== 'undefined') {
    window.ComposeInjector = ComposeInjector;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
