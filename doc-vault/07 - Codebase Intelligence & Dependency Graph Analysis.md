# 07 - Codebase Intelligence & Dependency Graph Analysis

## Executive Summary

| Metric | Measurement | Interpretation |
| :--- | :--- | :--- |
| **Total Source Files** | 41 files | Very lean footprint, self-contained. |
| **Core JS Logic Lines** | ~10,860 lines | Clean separation between DOM injection, automation, background, and dashboard. |
| **Runtime NPM Dependencies** | **0 (Zero)** | Pure browser stdlib (IndexedDB, Web Crypto, BroadcastChannel/Ports). |
| **Network Overhead** | 0 external calls | Operates strictly on `mail.google.com`, `docs.google.com`, and `drive.google.com`. |
| **Layering Integrity** | High | Unidirectional message flows: UI &rarr; Content Script &rarr; Service Worker &rarr; IDB. |

---

## Component Role Map & Dependency Graph

```
+---------------------------------------------------------------------------------+
|                                    MANIFEST V3                                  |
+---------------------------------------------------------------------------------+
           |                                                        |
           v                                                        v
+------------------------+                             +------------------------+
|  Content Script Layer  |                             | Background Worker Layer|
|  (Injected into Gmail) |                             |   (Offscreen Event Hub)|
+------------------------+                             +------------------------+
| 1. idb-store.js        |                             | 1. service-worker.js   |
|    - Schema & Defaults |                             |    - Heartbeat & Alarms|
|    - 232 Template Gen  |                             |    - Account Lock Pool |
| 2. gmail-automator.js  |  chrome.runtime.sendMessage |    - Power Wake Lock   |
|    - Human Clicks      |<--------------------------->|    - Live Port Stream  |
|    - DOM Selectors     |                             | 2. idb-store.js        |
|    - Drive Picker Wait |                             |    - Background Storage|
| 3. content.js          |                             +------------------------+
|    - Toolbar UI Button |                                          ^
|    - Dynamic Domain    |                                          |
|    - Compose Hook      |                                          |
+------------------------+                                          |
           |                                                        |
           +--------------------+     +-----------------------------+
                                |     |
                                v     v
                    +------------------------+
                    |  Dashboard / Popup UI  |
                    |  (Options & Extension) |
                    +------------------------+
                    | 1. dashboard.js & html |
                    |    - Real-time Grid    |
                    |    - Campaign Queue    |
                    |    - Template Manager  |
                    |    - Forensics Viewer  |
                    | 2. popup.js & html     |
                    |    - Quick Health Pill |
                    +------------------------+
```

---

## Critical Execution Paths & Blast Radius

### 1. The Composition Injection Path
- **File**: [content.js](file:///D:/projects/extension/src/content/content.js#L1120-L1180) &rarr; `resolveDynamicTemplate()`
- **Impact**: Any regression in `resolveDynamicTemplate()` directly affects all outgoing emails.
- **Blast Radius**: Isolated to Gmail Compose DOM. It does not affect background scheduling or database persistence.

### 2. The Campaign Dispatch Path
- **File**: [service-worker.js](file:///D:/projects/extension/src/background/service-worker.js#L580-L640) &rarr; `executeCampaign()`
- **Concurrency Protection**: Enforced by `accountLocks` map (`MAX_CONCURRENT_ACCOUNTS = 3`).
- **Blast Radius**: Account-isolated. If Account A encounters a Google Drive Picker timeout, Accounts B and C continue uninterrupted.

### 3. Storage Persistence Path
- **File**: [idb-store.js](file:///D:/projects/extension/src/db/idb-store.js)
- **Version**: Version `5`. Auto-upgrade triggered on extension update.
- **Tombstoning**: Tombstoned IDs are persisted to `chrome.storage.local` to prevent deleted campaigns from reappearing across sync events.
