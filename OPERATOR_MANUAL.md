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

## 🖥️ 6. PC, Laptop & Monitor Setup: What Will You See on Screen?

### A. Power & Hardware Settings (PC & Laptop)
| Setting | Recommended Value | Why It Matters |
| :--- | :--- | :--- |
| **Power Charger** | **Always Plugged In** | Windows throttles CPU and background timers when running on battery. |
| **Laptop Lid Action** | **"Do Nothing"** | Allows you to shut the laptop lid overnight while mail merge continues running. |
| **System Sleep** | **"Never"** | Prevents Windows from putting the computer into deep sleep. |
| **Screen / Display** | **Turns off after 15 min** | Completely safe! Turning off the physical screen saves power & prevents screen burn-in; CPU, WiFi, and Chrome stay 100% active. |
| **Windows Lock (`Win + L`)** | **Supported** | You can lock your workstation for security; background dispatches continue uninterrupted. |
| **Chrome Setting** | **Background Apps ON** | In `chrome://settings/system`, keep *"Continue running background apps when Google Chrome is closed"* turned **ON**. |

> 💡 **Tip:** Running **`SETUP_FRESH_PC.bat`** as Administrator once automatically configures all of the above Windows and Chrome settings for you.

---

### B. What Will the Operator See on Screen During Operation?

1. **While Campaigns Are Waiting in Queue (e.g. Scheduled for 11:00 PM tonight):**
   - **On Screen:** Nothing interrupts you. Normal desktop and normal Gmail inbox.
   - **In Dashboard:** Status shows `QUEUED` with the exact scheduled dispatch time.
   - **What you can do:** You can minimize Chrome, lock the PC (`Win + L`), or let the monitor turn off.

2. **At the Exact Moment of Dispatch (The Automated Send):**
   - **If Chrome is minimized or screen is locked:** The dispatch executes **silently in the background** without waking your screen or disturbing you.
   - **If you are actively looking at the Gmail tab:** The draft compose window will open briefly (3–5 seconds), automate the Mail Merge popup dialog, click "Send", and automatically close once sent.
   - **In the Dashboard (`dashboard.html`):** The campaign status automatically updates in real-time without reloading:
     - `QUEUED` ➡️ `PROCESSING` (with live progress bar 0% ➡️ 100%).
     - `PROCESSING` ➡️ `COMPLETED` (green badge).
   - **Windows Notification:** A native desktop notification pops up in the bottom-right corner:  
     *"Mail Merge Completed: Campaign successfully dispatched."*

---

## ✅ 7. Daily 30-Second Operator Checklist

Before you clock out or leave your laptop for unattended overnight sending:

- [ ] **PC Setup:** You ran `SETUP_FRESH_PC.bat` on this computer at least once.
- [ ] **Power:** Laptop is plugged into its power charger (AC power).
- [ ] **Browser Window:** Google Chrome is open with at least one **Gmail** tab active.
- [ ] **Dashboard Check:** The green indicator shows **"Scheduler Active"** in the Dashboard header.
- [ ] **Queue Check:** Click the **"Queued"** filter to verify your scheduled dispatches are set correctly.
- [ ] **Leaving the PC:** You can lock Windows (`Win + L`), close the laptop lid, or turn off the physical monitor.

**You are all set for smooth, automatic 24/7 mail merge operations!**

---

## 💎 8. Google Workspace Paid Subscription (₹1,200/mo Edition) Knowledge Vault

> **Important Fact:**  
> A monthly subscription of **₹1,200/user/month** corresponds to **Google Workspace Business Standard**. While this gives you the maximum sending power Google offers, **Google Workspace does NOT offer unlimited mail merge to any user at any price tier.** Understanding these rules prevents unexpected campaign halts.

### A. The "1,500 vs 2,000" Partition Rule
| Category | Official Daily Limit | Details |
| :--- | :---: | :--- |
| **Mail Merge (Multi-Send)** | **1,500 emails / 24 hrs** | Hard ceiling for mail merge / automated campaign dispatches across all paid Workspace editions. |
| **Standard 1-to-1 Emails** | **500 emails / 24 hrs** | Reserved strictly for interactive human emails (replies, personal threads) so your inbox never gets locked. |
| **Total Daily Workspace Quota** | **2,000 emails / 24 hrs** | Combined total of Mail Merge (1,500 max) + Standard interactive sends (500). |
| **Account Spend Threshold** | **$100 USD Cumulative** | If a new Workspace account hasn't reached $100 cumulative billing (~₹8,300+ INR total domain history), Google caps mail merge at 500 emails/day. |

---

### B. Why Did You Hit the Limit with "Only 25 Emails Per Sheet"?

1. **The "Ghost Rows" Phenomenon (99 Recipients Sent Instead of 25):**
   - In Google Sheets, if rows below row 26 were previously used and cleared with `Backspace` or have borders/spaces, Google Sheets marks them as active data.
   - When connecting the sheet to Gmail Mail Merge, Google reads all 99 rows!
   - **The Proof:** Google's bounce email explicitly stated: *"Message could not be delivered to these 99 recipients using multi-send mode."*
   - **The Fix:** In Google Sheets, highlight row 26 downwards ➡️ Right-click ➡️ **"Delete rows 26 - 1000"**.
   - **The Pre-Flight Check:** In the extension's Schedule Popover, check the green badge: `[✅ Sheet Connected (25 recipients)]`. If it says `99 recipients`, stop and clean the sheet.

2. **The 24-Hour Rolling Window Math (Not Midnight Reset):**
   - Google limits do **not reset at 12:00 AM midnight**. They reset on a rolling 1,440-minute window from the exact minute each email was sent.
   - If running **17 campaigns per hour** at 25 emails each:
     $$\text{17 campaigns} \times 25\text{ emails} = 425\text{ emails/hour}$$
     - Hour 1: 425 emails
     - Hour 2: 850 emails
     - Hour 3: 1,275 emails
     - **Hour 3.5: 1,500 limit reached!**
   - The sending engine will automatically freeze until 24 hours have elapsed since the first batch.

3. **Hourly Velocity / Burst Throttling:**
   - Even if you are under 1,500 total, blasting 15–17 campaigns in a single 60-minute window trips Google's automated anti-abuse / bot detection.
   - **Best Practice:** Pace campaigns to **4 to 6 campaigns per hour**.

4. **The CC / BCC Quota Multiplier:**
   - Every email added to CC or BCC is sent to every recipient row.
   - If a 25-email sheet has **1 address in CC**, Google deducts **50 emails** from your 1,500 daily quota ($25 \times 2 = 50$).

---

### C. How to Scale Beyond 1,500 Emails/Day (Multi-Account Rotation)

Because your ₹1,200/month subscription is **per user account**, you can scale volume cleanly across multiple accounts under your domain:

| Workspace Setup | Max Daily Mail Merge Capacity | Recommended Distribution |
| :--- | :---: | :--- |
| **1 Account** (`editor@...`) | **1,500 emails / day** | ~60 campaigns of 25 emails spread over 12 hours |
| **2 Accounts** (`/u/0/` + `/u/1/`) | **3,000 emails / day** | Account 1: Morning (1,500) • Account 2: Afternoon (1,500) |
| **3 Accounts** (`/u/0/` + `/u/1/` + `/u/2/`) | **4,500 emails / day** | 1,500 emails per account, zero quota locks |

---

### D. Viewing Internal Error Codes in Google Admin Console
If any campaign is deferred, a Google Workspace Admin can view the exact technical reason:
1. Open [Google Admin Console](https://admin.google.com).
2. Navigate to **Reporting** ➡️ **Audit and investigation** ➡️ **Gmail log search**.
3. Search by sender address and the dispatch timestamp.
4. Google will output the exact internal verdict:
   - `QUOTA_EXCEEDED_ROLLING_24H` — 1,500 rolling quota exhausted.
   - `RATE_LIMIT_EXCEEDED` — Dispatched too fast in 1 hour.
   - `SUSPECTED_SPAM_THROTTLE` — Spam complaint or dead recipient bounce threshold reached.

