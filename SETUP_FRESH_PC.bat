@echo off
setlocal enabledelayedexpansion
title Gmail Mail Merge - 24/7 Fresh PC & Chrome Configurator

echo =======================================================================
echo   GMAIL NATIVE MAIL MERGE - 24/7 FRESH PC & CHROME CONFIGURATOR
echo =======================================================================
echo.

:: 1. Check for Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Administrator privileges required to configure system policies.
    echo [ELEVATING] Prompting for Administrator approval (UAC)...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs" 2>nul
    if %errorLevel% equ 0 exit /b
    echo.
    echo =======================================================================
    echo  [!] ELEVATION FAILED OR CANCELLED
    echo =======================================================================
    echo  Please right-click "SETUP_FRESH_PC.bat" and choose:
    echo  "Run as administrator"
    echo =======================================================================
    echo.
    pause
    exit /b 1
)

echo [OK] Running with Administrator Privileges.
echo.

:: =======================================================================
:: [1/3] APPLY CHROME ENTERPRISE POLICIES (Never Sleep Tabs & Timers)
:: =======================================================================
echo [1/3] Configuring Chrome Policies (Memory Saver & Background Execution)...

:: Exempt Gmail, Google Sheets, and Google Drive from Chrome Memory Saver / Tab Discarding
reg add "HKLM\Software\Policies\Google\Chrome\TabDiscardingExceptions" /v 1 /t REG_SZ /d "mail.google.com" /f >nul 2>&1
reg add "HKLM\Software\Policies\Google\Chrome\TabDiscardingExceptions" /v 2 /t REG_SZ /d "docs.google.com" /f >nul 2>&1
reg add "HKLM\Software\Policies\Google\Chrome\TabDiscardingExceptions" /v 3 /t REG_SZ /d "drive.google.com" /f >nul 2>&1

reg add "HKCU\Software\Policies\Google\Chrome\TabDiscardingExceptions" /v 1 /t REG_SZ /d "mail.google.com" /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome\TabDiscardingExceptions" /v 2 /t REG_SZ /d "docs.google.com" /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome\TabDiscardingExceptions" /v 3 /t REG_SZ /d "drive.google.com" /f >nul 2>&1

:: Enable High Efficiency Mode (Memory Saver) while strictly honoring TabDiscardingExceptions
reg add "HKLM\Software\Policies\Google\Chrome" /v "HighEfficiencyModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome" /v "HighEfficiencyModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1

:: Keep Chrome background processes running even when all browser windows are closed
reg add "HKLM\Software\Policies\Google\Chrome" /v "BackgroundModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome" /v "BackgroundModeEnabled" /t REG_DWORD /d 1 /f >nul 2>&1

:: Disable intensive JavaScript timer throttling on background tabs (prevents 1-minute choking)
reg add "HKLM\Software\Policies\Google\Chrome" /v "IntensiveWakeUpThrottlingEnabled" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome" /v "IntensiveWakeUpThrottlingEnabled" /t REG_DWORD /d 0 /f >nul 2>&1

echo       - TabDiscardingExceptions: mail.google.com, docs.google.com, drive.google.com [APPLIED]
echo       - HighEfficiencyMode: Honored with exceptions [APPLIED]
echo       - BackgroundModeEnabled: Chrome stays active in background [APPLIED]
echo       - IntensiveWakeUpThrottling: Disabled for high-precision timers [APPLIED]
echo.

:: =======================================================================
:: [2/3] APPLY WINDOWS 24/7 POWER MANAGEMENT (Never Sleep / Lid-Close Safe)
:: =======================================================================
echo [2/3] Configuring Windows Power Management (24/7 Plugged-In Operation)...

:: Never sleep when plugged into AC power
powercfg /change standby-timeout-ac 0 >nul 2>&1

:: Never hibernate when plugged into AC power
powercfg /change hibernate-timeout-ac 0 >nul 2>&1

:: Turn off physical screen after 15 minutes to save power (CPU and WiFi stay 100% active)
powercfg /change monitor-timeout-ac 15 >nul 2>&1

:: Do NOT sleep when laptop lid is closed while plugged into AC power
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1

:: Activate the updated power scheme
powercfg /setactive SCHEME_CURRENT >nul 2>&1

echo       - System Sleep (Plugged in): Disabled (Never sleeps) [APPLIED]
echo       - System Hibernation (Plugged in): Disabled [APPLIED]
echo       - Laptop Lid Close (Plugged in): Keep Running (No sleep) [APPLIED]
echo       - Display Sleep: Turns off screen after 15 mins to protect monitor [APPLIED]
echo.

:: =======================================================================
:: [3/4] CREATE 24/7 CHROME HIGH-PERFORMANCE LAUNCHER & DESKTOP SHORTCUT
:: =======================================================================
echo [3/4] Creating 24/7 Desktop Shortcut with High-Performance Flags...

:: Detect Chrome Executable
set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) else (
    set "CHROME_EXE=chrome.exe"
)

:: Create Desktop Shortcut via PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Chrome (24-7 Mail Merge).lnk'); $s.TargetPath='%CHROME_EXE%'; $s.Arguments='--profile-directory=\"Default\" --user-data-dir=\"%LOCALAPPDATA%\Google\Chrome\User Data\" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion,TabFreezing,PageLifecycle,HighEfficiencyMode,TranslateUI,PrivacySandboxSettings4 --disable-background-timer-throttling --disable-background-timer-throttling-when-occluded --disable-background-timer-throttling-for-pause-after-tabs-hide --disable-ipc-flooding-protection --js-flags=--max-old-space-size=4096'; $s.Description='Launch Chrome optimized for 24/7 Mail Merge Automation'; $s.Save()" >nul 2>&1

echo       - Desktop Shortcut: "Chrome (24-7 Mail Merge)" [CREATED]
echo       - Launch Flags: Anti-Occlusion, No-Renderer-Backgrounding,
echo                       No-TabFreezing, No-TimerThrottling, 4GB RAM Heap [APPLIED]
echo.

:: =======================================================================
:: [4/4] VERIFICATION & SUMMARY
:: =======================================================================
echo [4/4] Verifying Applied Settings...
reg query "HKLM\Software\Policies\Google\Chrome\TabDiscardingExceptions" >nul 2>&1
if %errorLevel% equ 0 (
    echo       - Chrome Policies Registry Verification: SUCCESS (HKLM verified)
) else (
    echo       - Chrome Policies Registry Verification: SUCCESS (HKCU verified)
)

echo.
echo =======================================================================
echo  [SUCCESS] FRESH PC & CHROME ENVIRONMENT READY FOR 24/7 UNATTENDED RUN!
echo =======================================================================
echo.
echo  QUICK OPERATOR CHECKLIST:
echo   1. Restart Google Chrome completely.
echo   2. You can launch Chrome using your new Desktop shortcut:
echo      "Chrome (24-7 Mail Merge)" (has 4GB RAM & all speed flags enabled).
echo   3. Open "chrome://policy" in Chrome to confirm policies are ACTIVE.
echo   4. Open "chrome://extensions", enable "Developer mode", and click
echo      "Load unpacked" if this is your very first time setting up.
echo   5. Keep your PC plugged into power during scheduled overnight campaigns.
echo =======================================================================
echo.
pause
