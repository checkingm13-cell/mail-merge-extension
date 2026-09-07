# 🚀 Turnkey Guide: 24/7 Live Mail Merge on Oracle Cloud VPS

This guide shows you how to deploy the **Gmail Native Mail Merge Extension** to run **live 24/7** on your Oracle Cloud VPS (`mail-merge-vps`) so campaigns execute on schedule even when your personal computer is turned off.

---

## Prerequisites
* **Oracle Cloud VPS Instance**: `mail-merge-vps` (Ubuntu 22.04 LTS).
* **Tailscale**: Already configured on your Windows PC (`100.64.103.62`) and VPS (`100.96.100.52`).
* **VNC Viewer** (Optional for 1-time login): RealVNC Viewer, TigerVNC, or TightVNC on Windows.

---

## Step 1: Start Your VPS & Connect via SSH

1. In the Oracle Cloud Console, make sure your instance `mail-merge-vps` is in the **RUNNING** state.
2. Open PowerShell or Terminal on this Windows PC and connect via Tailscale SSH:
   ```bash
   ssh ubuntu@100.96.100.52
   ```

---

## Step 2: Clone Extension & Run Automated Setup

Run the following commands on your VPS:

```bash
# 1. Clone repository
cd ~
git clone https://github.com/checkingm13-cell/mail-merge-extension.git

# 2. Run automated setup (installs Chrome, Xvfb, x11vnc, PM2)
cd ~/mail-merge-extension
chmod +x cloud/setup-cloud-chrome.sh cloud/start-cloud-chrome.sh
./cloud/setup-cloud-chrome.sh
```

---

## Step 3: Launch 24/7 Runner with PM2

Start the cloud runner under PM2 process manager:

```bash
cd ~/mail-merge-extension
pm2 start cloud/ecosystem.config.js
pm2 save
pm2 startup
```

PM2 will keep Google Chrome and your extension running 24 hours a day, 7 days a week, and auto-restart if the VPS ever reboots.

---

## Step 4: Perform 1-Time Google Login via VNC

Because this runs real Google Chrome with your extension loaded:

1. Open your VNC Viewer on your Windows PC.
2. Connect to:
   ```text
   100.96.100.52:5900
   ```
   *(No password required because it is secured inside your private Tailscale network).*
3. You will see Chrome open to **`https://mail.google.com/`** on the virtual display.
4. Log into your Gmail account(s) and complete your Google 2FA prompt on your phone.
5. Once logged into Gmail, **you are completely done!**

---

## Step 5: Verify 24/7 Operation

1. Open a draft in Gmail inside the VNC Chrome, link your sheet, and click **`📅 Schedule`**.
2. Close your VNC viewer.
3. **Turn off or put your Windows computer to sleep.**
4. At the scheduled minute, the Oracle Cloud VPS will open the draft, click "Continue", and click "Send all" automatically!
5. When you check your phone or Gmail later, all emails will be in your **Sent** folder!

---

## Helpful Commands on VPS

| Action | Command |
|---|---|
| **Check Runner Status** | `pm2 status` |
| **View Live Logs** | `pm2 logs mail-merge-cloud-runner` |
| **Restart Runner** | `pm2 restart mail-merge-cloud-runner` |
| **Stop Runner** | `pm2 stop mail-merge-cloud-runner` |
| **Update Extension** | `cd ~/mail-merge-extension && git pull && pm2 restart mail-merge-cloud-runner` |
