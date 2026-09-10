# 📖 24/7 Mail Merge Operator Guide (250 Campaigns/Day)

> **Who is this guide for?**  
> This guide is written in **plain, simple English** for operators, office assistants, and team members. You do not need any coding or technical knowledge. If you can use Gmail, you can run 250 campaigns a day with this system!

---

## ⚡ 1. One-Time Setup on Any PC or Laptop (Under 60 Seconds)

Before running campaigns on any new computer or laptop, run the 1-click setup file so your PC never sleeps and Chrome never freezes your scheduled emails overnight:

1. **Locate the file:** Look for **`SETUP_FRESH_PC.bat`** in your extension folder (or click **"⬇️ Download SETUP_FRESH_PC.bat"** inside the extension Dashboard).
2. **Right-click `SETUP_FRESH_PC.bat`** and click **"Run as administrator"**.
3. Click **"Yes"** on the Windows confirmation pop-up.
4. **What does this do automatically?**
   - 🛡️ **Prevents Windows Sleep:** Your laptop will **never go to sleep** even if you close the lid or leave it on battery/charger overnight. (Your monitor screen will still turn off after 15 minutes to save power, but the sending engine stays 100% awake).
   - 🛡️ **Stops Chrome Tab Freezing:** Windows and Chrome are permanently configured to **never freeze or discard** `mail.google.com`, `docs.google.com`, or `drive.google.com`.
   - 🚀 **Creates Desktop Shortcut:** Creates a desktop shortcut named **`Chrome (24-7 Mail Merge)`** that starts Chrome with dedicated 4GB RAM and uninterrupted background timers.
5. Double-click the new **`Chrome (24-7 Mail Merge)`** icon on your Desktop (or double-click **`LAUNCH_CHROME_247.bat`**). You are ready!

---

## 🚀 2. How to Schedule 250 Campaigns Daily (Fast & Simple)

### Method A: Scheduling Directly from Gmail Compose
1. Open **Gmail** (keep at least 1 Gmail tab open at all times).
2. Click **Compose** (+).
3. **Connect Your Sheet:**
   - Click the Mail Merge / Google Sheet icon at the bottom of the Compose box.
   - Select your Google Spreadsheet with your recipient emails.
4. **Click the Purple "Schedule" Button:**
   - You will see two clear badges: **`✅ Sheet Connected`** and **`⏰ Time Selected`**.
   - Pick your template from the dropdown (or type your message).
   - Pick the date and time (or click quick buttons: **Now**, **+2m**, **+5m**, **+15m**, **+30m**).
   - Click **"Schedule & Save Draft"**.
5. The popover closes, the draft is safely preserved in Google's cloud, and your campaign appears instantly in the Dashboard.

### Method B: 1-Click "📋 Clone" from Dashboard (Best for High Volume!)
When scheduling 50 to 250 campaigns in a single morning:
1. Open the **Dashboard** (`chrome-extension://.../src/dashboard/dashboard.html`).
2. Find any previous campaign you already scheduled.
3. Click the **"📋 Clone"** button on the right side of the row.
4. **Done!** The entire Queue form opens with your sender account, recipient column, and Google Sheet link pre-filled with zero re-typing. Just pick your send time and click **"Queue Campaign"**!

---

## 🖥️ 3. Zero-Reload Live Dashboard & Toolbar Popup

You **never need to press F5 or reload the page**. 

- **Live Streaming & Hot-Sync:** The Dashboard and the Toolbar Popup are connected to a 24/7 live background communication stream (`MM_LIVE_STREAM`). 
- Whenever an email sends, a campaign progresses (Step 1/5 ➡️ Step 5/5), completes, or encounters an error, the screen **updates automatically in real time**.
- **📅 "Today" Filter:** Click the **"📅 Today"** filter pill at the top of the Dashboard to see only the campaigns scheduled or created today.
- **Page Size Selector (50 / 100 / 250 / All):** Slices high volumes into smooth pages so budget laptops never lag or freeze.
- **🧹 Archive Completed:** At the end of the day or week, click the **"🧹 Archive Completed"** button. This safely moves all completed campaigns into archived storage, keeping your active table fast, clean, and uncluttered.

---

## 🎯 4. Handling Errors: Plain-English Diagnostic Guide

If any campaign stops or fails, it will display a clear red badge. You never have to guess what went wrong:

| Error You See | Can You Retry? | What Happened & How to Fix It (1-Click) |
|---|:---:|---|
| **📄 Sheet Disconnected / "No Recipients"** | **✅ YES** | Google momentarily disconnected the sheet. Open the draft in Gmail, re-select the sheet, then click **`[↻ Retry Now]`** in the Dashboard. |
| **🌐 Network Offline / Wi-Fi Disconnected** | **✅ YES** | Office Wi-Fi or router dropped during the night. Reconnect Wi-Fi and click **`[↻ Retry All Failed]`**. |
| **🔄 Google Rate Limit ("Can't Open Sheet")** | **✅ Auto / YES** | Google was momentarily overloaded. The extension auto-retries in 2 minutes, or click **`[↻ Retry Now]`**. |
| **🔑 Session Expired ("Verify it's you")** | **✅ YES** | Google logged you out. Open Gmail, sign in with your password, and click **`[↻ Retry Now]`**. |
| **🗂️ Draft Missing / Draft Deleted** | **❌ No Auto-Retry** | The draft was deleted from Gmail Drafts folder. Click **`[📋 Clone]`** in Dashboard to pre-fill the form, then click **Queue**. |
| **⏳ Daily Limit Reached (1,500/day)** | **⏳ Wait 12-24h** | Google allows 1,500 emails/day per Google Workspace account. The extension automatically pauses and will resume when Google's quota resets tomorrow, or switch to Account #2 (`/u/1/`). |

### ⚡ The "↻ Retry All Failed" Emergency Button
If your computer went to sleep or Wi-Fi dropped overnight, several campaigns might show FAILED in the morning.
- Look at the top of the Dashboard or Popup for the red banner: **"X Campaign(s) Require Attention"**.
- Simply click **`[↻ Retry All Failed]`**.
- All retryable campaigns are immediately re-entered into the live sending queue with 1 click!

---

## 📝 5. Managing Templates & Dynamic Links

You can create and customize rich templates with live hyperlinks that automatically adjust to whichever email account is sending:

1. Open the Dashboard ➡️ Click **"📝 Templates Manager"**.
2. Click **"➕ Create Template"** or click **"✏️ Edit"** on any existing template.
3. Use the **"🔗 Insert Dynamic Link"** tool:
   - **Link Text:** The clickable text the recipient sees (e.g., *"Submit Your Research Article"*).
   - **URL with `{{senderDomain}}`:**  
     `https://{{senderDomain}}/journal-page/submit`
   - **Why this is magic:**
     - If sent from `editor@ijsr.net` ➡️ link becomes `https://ijsr.net/journal-page/submit`
     - If sent from `info@worldwidejournals.com` ➡️ link becomes `https://worldwidejournals.com/journal-page/submit`
     - You only need **one template** for all your domains!
4. Click **"💾 Save Template"**. All drafts and teammates receive the updated template immediately.

---

## ✅ 6. Daily 30-Second Operator Checklist

Before you clock out or leave your laptop for unattended overnight sending:

- [ ] **PC Setup:** You ran `SETUP_FRESH_PC.bat` on this computer at least once.
- [ ] **Browser Window:** Google Chrome is open with at least one **Gmail** tab active.
- [ ] **Laptop Lid:** The laptop is plugged into its power charger. (Closing the lid is fine if `SETUP_FRESH_PC.bat` was run).
- [ ] **Dashboard Check:** The green dot shows **"Scheduler Active"** in the Dashboard header.
- [ ] **Queue Check:** Click the **"Queued"** filter tab to verify your scheduled times are set correctly.

**You are all set for smooth, automatic 24/7 mail merge operations!**
