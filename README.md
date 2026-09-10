# Gmail Native Mail Merge & Scheduler (Chrome Extension)

Automate and schedule Gmail native Mail Merge campaigns with local database storage, Google Drive sheet attachment safeguards, and dynamic domain link resolution.

---

## 🚀 Quick Setup for Fresh PC / Laptop (1-Minute Setup)

Whenever you download or copy this folder to a new Windows PC or laptop:

### Step 1: Run the 1-Click Fresh PC Configurator
Double-click:
```text
SETUP_FRESH_PC.bat
```
> **What this does:** Automatically applies Chrome Enterprise performance policies so Chrome **never sleeps or frees memory** from `mail.google.com`, `docs.google.com`, and `drive.google.com`. Zero manual configuration needed!

### Step 2: Load the Extension in Google Chrome
1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Toggle **Developer mode** **ON** in the top-right corner.
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select this extension directory (`D:\projects\extension`).
5. That's it! The extension is now active and ready for production use.

---

## ✨ Production Features

1. **Persistent Google Sheet Attachment & Hydration Guard:**
   - Detects Gmail's `"Saved"` state + applies a 1.2s commit buffer before closing compose windows.
   - Grants up to **10 seconds** for Google Drive to hydrate sheet columns upon scheduled execution.
   - Eliminates `"No recipients"` and `"Mail Merge Inactive"` false errors.

2. **Dynamic Sender Domain & Email Link Resolver:**
   - Auto-detects the active sender's email and domain (e.g. `editor@ijsr.net` ➡️ `ijsr.net`).
   - Replaces `{{senderDomain}}` / `{senderdomain}` / `{senderemail}` automatically.
   - Auto-converts relative links like `href="/upload-your-article"` into fully qualified `https://${senderDomain}/upload-your-article` absolute links.

3. **Preloaded Production Templates:**
   - Preloaded **IJSR Research Paper Submission** template with dynamic journal submission and opt-out links.
   - Full Template Manager inside the extension Dashboard (`chrome-extension://.../src/dashboard/dashboard.html`).

4. **Self-Healing & 1-Click Retry Mechanism:**
   - 15-minute background session keep-alive ping.
   - Built-in **"↻ Retry Now"** and **"↻ Retry All"** buttons in the Popup and Dashboard for zero-downtime recovery.

---

## 🛠️ Maintenance & Useful Scripts

- `SETUP_FRESH_PC.bat` — Run once on any new PC to configure Chrome performance policies.
- `RELOAD_EXTENSION.bat` — Quickly opens Chrome extensions page with reload instructions.
- `RUN_LIVE_GMAIL.bat` — Runs a safe dry-run test against live Gmail.
- `RUN_TESTS.bat` — Executes the automated end-to-end test suite.
