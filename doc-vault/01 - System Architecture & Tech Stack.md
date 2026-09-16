# 01 - System Architecture & Tech Stack

## Overview

The **Gmail Mail Merge & Scheduler** extension is an enterprise-grade automation engine designed to turn Google Chrome into an autonomous 24/7 campaign sender while completely preserving native Gmail Mail Merge, unsubscribe headers, and rate limits.

```
+-------------------------------------------------------------------------------+
|                               Google Chrome Host                              |
|                                                                               |
|  +-------------------------+                     +-------------------------+  |
|  |   Gmail Active Tabs     |                     |    Extension Views      |  |
|  |  (mail.google.com)      |                     |   Dashboard / Popup     |  |
|  |                         |                     |                         |  |
|  |  +-------------------+  |  chrome.runtime     |  +-------------------+  |  |
|  |  | content.js        |<-+-- messages -------->|  | dashboard.js      |  |  |
|  |  | (DOM Injector &   |  |   Port Stream       |  | (Management GUI)  |  |  |
|  |  |  UI Overlay)      |  |                     |  +-------------------+  |  |
|  |  +-------------------+  |                     +-------------------------+  |
|  |           |             |                                  |               |
|  |  +-------------------+  |                                  |               |
|  |  | gmail-automator.js|  |                                  |               |
|  |  | (Human Emulation) |  |                                  |               |
|  |  +-------------------+  |                                  |               |
|  +-----------+-------------+                                  |               |
|              |                                                |               |
|              v                                                v               |
|  +-------------------------------------------------------------------------+  |
|  |               Background Service Worker (service-worker.js)             |  |
|  |  - High-frequency Campaign Poller (POLL_CAMPAIGNS_ALARM)                |  |
|  |  - Multi-account Lock Registry (Concurrency Pool)                       |  |
|  |  - System Power Wake-Lock (Prevents CPU Sleep Overnight)                |  |
|  |  - Tombstoning Engine (Prevents Ghost Campaign Resurrections)           |  |
|  +-------------------------------------------------------------------------+  |
|                                      |                                        |
|                                      v                                        |
|  +-------------------------------------------------------------------------+  |
|  |                      IndexedDB Storage (idb-store.js)                   |  |
|  |                         Database: GmailMailMergeDB                      |  |
|  |                         Version: 5 (232 Templates)                      |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## Core Components

### 1. Content Script Layer (`src/content/content.js`)
- Injected automatically into all `mail.google.com` frames.
- Renders the custom **Schedule & Mail Merge** button inside the active Gmail Compose window toolbar next to the native "Send" button.
- Manages the modal dialog for choosing scheduled dispatch times, selecting templates from the 232 combination dropdown, and linking Google Sheets.
- Detects the sender email and resolves dynamic sender domain URLs at runtime.

### 2. Native Gmail Automator (`src/content/gmail-automator.js`)
- Human-like typing and click emulation (`humanClick`, `humanInput`, `fillMessageBody`).
- Interacts with Google Drive Picker iframe to select recipient spreadsheets.
- Handles native Google Mail Merge field tag insertion (`@name`, `[FNAME]`).
- Strictly preserves existing unsubscribe footers when applying new templates.

### 3. Background Service Worker (`src/background/service-worker.js`)
- **Manifest V3 Service Worker**: Keeps state clean and executes on event alarms.
- **System Wake-Lock**: Uses `chrome.power.requestKeepAwake('system')` to prevent the operating system from suspending CPU cycles during scheduled overnight runs.
- **Account-Level Concurrency Locks**: Prevents race conditions when multiple tabs or Google accounts are active simultaneously.
- **Real-Time Live Streaming**: Keeps connected dashboard views live via long-lived `MM_LIVE_STREAM` ports without requiring page refreshes.

### 4. Storage Engine (`src/db/idb-store.js`)
- Self-contained, zero-dependency IndexedDB wrapper operating in both window and service worker scopes.
- Stores campaigns, seeded default templates (232 combinations), audit logs, settings, and forensic snapshots.
