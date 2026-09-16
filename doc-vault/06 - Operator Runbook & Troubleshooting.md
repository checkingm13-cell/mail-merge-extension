# 06 - Operator Runbook & Troubleshooting

## Daily Operator Workflow

### 1. Launching the System
Always launch using the watchdog script on Windows:
```cmd
D:\projects\extension\LAUNCH_CHROME_247.bat
```
*Do not close the Command Prompt window.* It maintains the 24/7 watchdog process that will automatically revive Chrome if the window is closed or crashes.

### 2. Composing & Scheduling an Email
1. In Gmail, click **Compose**.
2. Look for the blue **Schedule & Mail Merge** button next to "Send".
3. In the overlay dialog, open the **Journal & Subject Combination** dropdown.
4. Select any of the **232 combinations** grouped by:
   - `[IJSR - Detailed]`, `[IJAR - Detailed]`, `[GJRA - Detailed]`, `[PIJR - Detailed]`
   - `[IJSR - Short]`, `[IJAR - Short]`, `[GJRA - Short]`, `[PIJR - Short]`
5. Observe that:
   - Subject automatically populates.
   - Body formats with exact Verdana/Arial typography and `Dear [FNAME]`.
   - Links dynamically resolve to your active sender domain.
   - Any native Gmail Mail Merge unsubscribe link is strictly preserved.
6. Set the dispatch time and click **Schedule & Save Draft**.

---

## Maintenance & Cache Cleaner

If you ever need to purge temporary Playwright/Puppeteer automation profiles or clean disk space:
```cmd
D:\projects\extension\CLEAN_CACHE.bat
```
This safely removes:
- `.live-profile/`
- `.test-profile/`
- `.diag-profile/`
- Temporary `.log` files

---

## Troubleshooting Guide

### 1. Templates not updating after a Git pull?
- **Cause**: Browser has older IndexedDB cached.
- **Solution**: The database version is bumped to `DB_VERSION = 5` in `src/db/idb-store.js`. Reload the extension via `chrome://extensions` &rarr; Click the circular Refresh icon on "Gmail Native Mail Merge & Scheduler". Then refresh the Gmail tab (F5).

### 2. "Extension context invalidated" error?
- **Cause**: The extension was reloaded in developer mode while a Gmail tab remained open.
- **Solution**: Simply press `F5` in the Gmail tab to bind the newly loaded extension content scripts.

### 3. Links showing `worldwidejournals.co.in` instead of custom subdomain?
- **Cause**: The sender account logged in is a personal `@gmail.com` address.
- **Behavior**: By design, generic webmail providers fall back to the central journal portal. When logged into an approved custom domain (e.g. `editor@publication.onlypaperpublication.com`), all links automatically swap to `https://publication.onlypaperpublication.com/...`.
