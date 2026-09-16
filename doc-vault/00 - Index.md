# Gmail Mail Merge & Scheduler Extension — Documentation Vault

Welcome to the comprehensive technical documentation and operator guide for the **Gmail Mail Merge & Scheduler Chrome Extension (Manifest V3)**.

---

## 🗺️ Documentation Vault Navigation

| File | Document | Description |
| :--- | :--- | :--- |
| [[01 - System Architecture & Tech Stack]] | **System Architecture** | Architecture of Content Scripts, Service Worker, IndexedDB v5, and Offscreen DOM. |
| [[02 - Dynamic Sender Domain Link Engine]] | **Dynamic Sender Domain Engine** | How sender emails are detected in real-time and relative links resolve to active sender domains. |
| [[03 - Email Template Matrix (232 Combinations)]] | **232 Email Template Matrix** | Complete inventory of the 8 template families across 29 subjects (Detailed & Short formats). |
| [[04 - 24-7 Automation & Chrome Watchdog]] | **24/7 Launcher & Watchdog** | Windows 7–11 launcher script, multi-tier Chrome detection, auto-retry loops, and keep-alive alarms. |
| [[05 - Database Schema & IDBStore Engine]] | **IndexedDB v5 Storage Engine** | Complete schema of `campaigns`, `templates`, `logs`, `settings`, and `forensics` object stores. |
| [[06 - Operator Runbook & Troubleshooting]] | **Operator Runbook** | Daily workflows, queueing campaigns, clearing test cache, and resolving Gmail DOM updates. |
| [[07 - Codebase Intelligence & Dependency Graph Analysis]] | **Codebase Intelligence** | Role map, dependency graph, component boundaries, and blast radius analysis. |
| [[08 - Ponytail Complexity Audit & Optimization Review]] | **Ponytail Review** | Complexity audit, over-engineering scan, 1-line findings, and dead-code reduction. |
| [[09 - Get Shit Done (GSD) Execution Spec & System State]] | **GSD Execution Spec** | Spec-driven goals, atomic verification checklist, and active system state. |

---

## ⚡ Quick System Overview

- **Engine**: Pure Vanilla JavaScript (Zero External NPM Dependencies at Runtime).
- **Manifest**: Chrome Extension Manifest V3.
- **Storage**: Browser IndexedDB (`GmailMailMergeDB` v5) + `chrome.storage.local`.
- **Concurrency**: Account-level locks supporting parallel dispatch across multiple Google accounts.
- **Default Combinations**: **232 combinations** seeded dynamically into IndexedDB (4 Journals × 29 Subjects × 2 Formats).
- **Dynamic Links**: 100% of upload and opt-out links dynamically adapt to the active Gmail account's sending domain.
