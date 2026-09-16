# 05 - Database Schema & IDBStore Engine

## Overview

The extension uses a zero-dependency IndexedDB library (`IDBStore` defined in `src/db/idb-store.js`) that operates identically in both DOM contexts (Content Scripts, Dashboard, Popup) and WebWorker contexts (Background Service Worker).

- **Database Name**: `GmailMailMergeDB`
- **Database Version**: `5`

---

## Object Stores & Indexes

### 1. `campaigns`
Stores all scheduled, active, and completed mail merge operations.
- **Primary Key**: `id` (string, e.g. `camp_1726478900_abcde`)
- **Indexes**:
  - `status` (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`)
  - `scheduledAt` (ISO Timestamp)
  - `createdAt` (ISO Timestamp)
- **Record Schema**:
  ```json
  {
    "id": "camp_1726478900_abcde",
    "status": "QUEUED",
    "subject": "Submit your Valuable Research for October issue",
    "body": "Dear [FNAME]...",
    "bodyHtml": "<span>...</span>",
    "scheduledAt": "2026-09-16T18:00:00.000Z",
    "createdAt": "2026-09-16T14:30:00.000Z",
    "accountEmail": "editorial@education.yourpaperpublication.com",
    "sheetId": "1aB2cD3eF4gH...",
    "recipientCount": 25,
    "sentCount": 0
  }
  ```

### 2. `templates`
Stores seeded canned combinations and user-saved custom templates.
- **Primary Key**: `id` (e.g. `tmpl_international_journal_of_scientific_research_detailed_sub_0`)
- **Indexes**:
  - `name` (string)
  - `createdAt` (ISO Timestamp)
- **Seeded Records**: 232 combinations automatically seeded via `_seedTemplatesIfEmpty`.

### 3. `logs`
Real-time audit log stream for forensic diagnostics.
- **Primary Key**: `id` (auto-increment integer)
- **Indexes**:
  - `campaignId` (string)
  - `timestamp` (ISO Timestamp)

### 4. `forensics`
Contains visual evidence and DOM captures when an automation step encounters unexpected errors.
- **Primary Key**: `id` (auto-increment integer)
- **Indexes**:
  - `campaignId` (string)
  - `timestamp` (ISO Timestamp)
  - `stage` (string, e.g. `PICKER_IFRAME_LOOKUP`, `COMPOSE_FINDER`)

### 5. `settings`
Key-value configuration store for safety ceilings and rolling quota rules.
- **Primary Key**: `key` (string)
- **Keys**:
  - `safeguard_settings`: `{ maxRecipientsPerSheet: 25, dailyQuotaCeiling: 1450 }`
