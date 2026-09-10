@echo off
title Chrome 24/7 Mail Merge Automation Launcher
echo =======================================================================
echo   GMAIL MAIL MERGE - 24/7 CHROME HIGH-PERFORMANCE LAUNCHER
echo =======================================================================
echo.

:: Locate Google Chrome executable
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

echo [INFO] Chrome Executable: "%CHROME_EXE%"

:: Check if Chrome is already running
tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul | find /i "chrome.exe" >nul
if %errorlevel% equ 0 (
    echo [NOTE] Chrome is already running. Flags apply to master process or new windows.
    echo        For 100%% flag activation, close Chrome completely first, then run this file.
)

echo [STARTING] Launching Chrome with full anti-throttling & 4GB heap flags...
echo.

start "" "%CHROME_EXE%" ^
  --profile-directory="Default" ^
  --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TabFreezing,PageLifecycle,HighEfficiencyMode,TranslateUI,PrivacySandboxSettings4 ^
  --disable-background-timer-throttling ^
  --disable-background-timer-throttling-when-occluded ^
  --disable-background-timer-throttling-for-pause-after-tabs-hide ^
  --disable-ipc-flooding-protection ^
  --js-flags="--max-old-space-size=4096"

echo =======================================================================
echo  [SUCCESS] Chrome launched with full 24/7 performance flags:
echo   - Window occlusion backgrounding: DISABLED
echo   - Background renderer priority drops: DISABLED
echo   - Tab freezing & page lifecycle discard: DISABLED
echo   - JavaScript timer throttling: DISABLED
echo   - V8 memory heap limit: EXPANDED TO 4 GB
echo   - Annoying UI popups (Translate/Privacy): DISABLED
echo =======================================================================
echo.
timeout /t 3 >nul
exit /b 0
