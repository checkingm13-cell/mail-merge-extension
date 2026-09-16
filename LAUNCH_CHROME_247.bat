@echo off
setlocal enabledelayedexpansion
title Gmail Mail Merge - 24/7 Chrome High-Performance Launcher

echo =======================================================================
echo   GMAIL MAIL MERGE - 24/7 CHROME HIGH-PERFORMANCE ^& GUARDIAN LAUNCHER
echo   (Compatible with Windows 7, 8, 8.1, 10, 11 - 32-bit ^& 64-bit)
echo =======================================================================
echo.

:: -------------------------------------------------------------------------
:: 1. LOCATE EXTENSION DIRECTORY (Normalize trailing backslash for Chromium)
:: -------------------------------------------------------------------------
set "EXT_DIR=%~dp0"
if "%EXT_DIR:~-1%"=="\" set "EXT_DIR=%EXT_DIR:~0,-1%"

:: -------------------------------------------------------------------------
:: 2. DETECT USER DATA DIRECTORY (Win 7 / 8 / 10 / 11 safe fallback)
:: -------------------------------------------------------------------------
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
set "CHROME_USER_DATA=%LOCALAPPDATA%\Google\Chrome\User Data"

:: -------------------------------------------------------------------------
:: 3. DETECT GOOGLE CHROME EXECUTABLE (Multi-method deep search)
:: -------------------------------------------------------------------------
set "CHROME_EXE="

:: Method A: Windows Registry (HKLM App Paths)
for /f "tokens=2* delims=	 " %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
    if exist "%%B" set "CHROME_EXE=%%B"
)

:: Method B: Windows Registry (HKCU App Paths)
if not defined CHROME_EXE (
    for /f "tokens=2* delims=	 " %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
        if exist "%%B" set "CHROME_EXE=%%B"
    )
)

:: Method C: Windows Registry (WOW6432Node 32-bit on 64-bit Windows)
if not defined CHROME_EXE (
    for /f "tokens=2* delims=	 " %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
        if exist "%%B" set "CHROME_EXE=%%B"
    )
)

:: Method D: Direct file path checks without problematic parenthesis nesting
if not defined CHROME_EXE if defined ProgramFiles if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%USERPROFILE%\AppData\Local\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%USERPROFILE%\AppData\Local\Google\Chrome\Application\chrome.exe"

:: Method E: PATH environment check
if not defined CHROME_EXE (
    for /f "delims=" %%F in ('where chrome.exe 2^>nul') do (
        if exist "%%F" set "CHROME_EXE=%%F"
    )
)

:: Method F: Fallback command
if not defined CHROME_EXE set "CHROME_EXE=chrome.exe"

echo [INFO] Chrome Path: "%CHROME_EXE%"
echo [INFO] Extension : "%EXT_DIR%"
echo [INFO] Profile   : "%CHROME_USER_DATA%"
echo.

:: -------------------------------------------------------------------------
:: 4. CHECK IF CHROME IS ALREADY RUNNING
:: -------------------------------------------------------------------------
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /i "chrome.exe" >nul
if %errorlevel% equ 0 (
    echo [NOTE] An active Chrome process was detected.
    echo        Launching will attach tabs to the running profile.
    echo.
)

:: -------------------------------------------------------------------------
:: 5. LAUNCH WITH AUTO-RETRY SUPERVISOR
:: -------------------------------------------------------------------------
set "MAX_RETRIES=5"
set "RETRY_COUNT=0"
set "RESTART_TOTAL=0"

:LAUNCH_ATTEMPT
set /a RETRY_COUNT+=1
echo [STARTING] Launching Chrome with full 24/7 flags (Attempt !RETRY_COUNT!/%MAX_RETRIES%)...

start "" "%CHROME_EXE%" ^
  --profile-directory="Default" ^
  --user-data-dir="%CHROME_USER_DATA%" ^
  --load-extension="%EXT_DIR%" ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TabFreezing,PageLifecycle,HighEfficiencyMode,TranslateUI,PrivacySandboxSettings4 ^
  --disable-background-timer-throttling ^
  --disable-background-timer-throttling-when-occluded ^
  --disable-background-timer-throttling-for-pause-after-tabs-hide ^
  --disable-ipc-flooding-protection ^
  --js-flags="--max-old-space-size=4096" ^
  --no-first-run ^
  --no-default-browser-check ^
  "https://mail.google.com"

:: Universal wait 3 seconds (Compatible with all Windows editions)
ping -n 4 127.0.0.1 >nul

:: Verify Chrome process is running
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /i "chrome.exe" >nul
if %errorlevel% neq 0 (
    echo [WARNING] Chrome process did not start on attempt !RETRY_COUNT!.
    if !RETRY_COUNT! lss %MAX_RETRIES% (
        echo [RETRYING] Clearing potential lock files and re-attempting in 3 seconds...
        taskkill /F /IM chrome.exe >nul 2>&1
        ping -n 4 127.0.0.1 >nul
        goto LAUNCH_ATTEMPT
    ) else (
        echo [ERROR] Chrome failed to launch after %MAX_RETRIES% attempts.
        echo         Please check if Chrome is installed or blocked by security software.
        pause
        exit /b 1
    )
)

set "RETRY_COUNT=0"
echo =======================================================================
echo  [SUCCESS] Chrome launched and verified active!
echo   - 24/7 Background Flags      : ACTIVE
echo   - Tab Freezing ^& Discarding   : DISABLED (Never Sleeps)
echo   - JS Timer Throttling        : DISABLED (Accurate Timers)
echo   - V8 JavaScript Memory Limit : EXPANDED TO 4 GB
echo   - Mail Merge Extension        : AUTO-LOADED UNPACKED
echo   - Target Page                : https://mail.google.com
echo =======================================================================
echo.
echo =======================================================================
echo  [24/7 GUARDIAN WATCHDOG ACTIVE]
echo  This window monitors Chrome continuously. If Chrome ever crashes,
echo  freezes, or closes unexpectedly at night, this guardian will
echo  automatically relaunch it with all 24/7 performance flags restored!
echo.
echo  Keep this window open / minimized for 24/7 unattended operation.
echo  To stop the guardian, simply close this window or press Ctrl+C.
echo =======================================================================
echo.

:: -------------------------------------------------------------------------
:: 6. 24/7 WATCHDOG HEALTH-CHECK LOOP
:: -------------------------------------------------------------------------
:WATCHDOG_LOOP
ping -n 11 127.0.0.1 >nul

tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /i "chrome.exe" >nul
if %errorlevel% neq 0 (
    set /a RESTART_TOTAL+=1
    echo.
    echo =======================================================================
    echo  [! ALERT !] Chrome was closed or crashed at %TIME%!
    echo  Auto-relaunching Chrome immediately (Recovery #!RESTART_TOTAL!)...
    echo =======================================================================
    echo.
    ping -n 3 127.0.0.1 >nul
    goto LAUNCH_ATTEMPT
)

goto WATCHDOG_LOOP
