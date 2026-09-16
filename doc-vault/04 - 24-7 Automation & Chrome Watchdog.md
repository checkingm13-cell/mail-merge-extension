# 04 - 24/7 Automation & Chrome Watchdog

## Overview

Running automated outreach from Google Chrome 24/7 requires solving three fundamental OS and browser issues:
1. Chrome processes crashing or being closed accidentally by operators.
2. Windows putting the CPU into connected standby/sleep overnight, freezing background timers.
3. Path inconsistencies across different Windows versions (Windows 7, 8.1, 10, 11, 32-bit vs 64-bit).

---

## 10-Tier Chrome Executable Auto-Detection

The batch launcher `LAUNCH_CHROME_247.bat` scans 10 standard paths and Windows Registry keys dynamically:

```bat
:: Tier 1: 64-bit Program Files
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" ...
:: Tier 2: 32-bit Program Files (x86)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" ...
:: Tier 3: Local AppData (Per-User Install)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" ...
:: Tier 4-7: Windows Registry App Paths & Uninstall Keys
reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ...
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ...
:: Tier 8-10: Brave / Chromium Fallbacks
```

---

## Autonomous Watchdog Loop

The launcher never exits. It runs an infinite supervision loop that monitors the Chrome process ID:

```
+-------------------------------------------------------------+
| Launch Chrome with Persistent Automation Flags              |
|   --load-extension="D:\projects\extension"                  |
|   --user-data-dir="%USERPROFILE%\.gmail-automation-profile" |
|   --no-first-run --disable-fre --disable-sync               |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Sleep 10 Seconds & Ping Tasklist                            |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Process alive?                                              |
|   YES -> Continue monitoring loop                           |
|   NO  -> Increment crash counter & Auto-Relaunch (up to 5x) |
+-------------------------------------------------------------+
```

---

## System Wake-Lock Implementation

In `src/background/service-worker.js`, the service worker monitors active campaigns in IndexedDB. If any campaign is in `QUEUED` or `PROCESSING` state:

```javascript
// Requests OS to keep CPU active while allowing screen to sleep
chrome.power.requestKeepAwake('system');
```

When all campaigns reach `COMPLETED` or `FAILED`, the wake lock is gracefully released:
```javascript
chrome.power.releaseKeepAwake();
```
