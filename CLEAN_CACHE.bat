@echo off
setlocal enabledelayedexpansion
title Clean Extension Temporary Cache

echo =======================================================================
echo   GMAIL MAIL MERGE - TEMPORARY CACHE ^& TEST PROFILE PURGER
echo =======================================================================
echo.
echo This utility safely deletes temporary test browser profiles and logs:
echo   - .live-profile\  (Automated test runtime cache)
echo   - .test-profile\  (Playwright testing profile)
echo   - .diag-profile\  (Diagnostic profiling cache)
echo   - test-results\   (Screenshots and run logs)
echo.
echo Your extension source code, manifest, icons, and templates will remain
echo 100%% untouched. This reduces folder size from ~60MB down to ~550KB!
echo =======================================================================
echo.

set /p CONFIRM="Do you want to clean temporary cache now? (Y/N, default Y): "
if /i "%CONFIRM%"=="N" (
    echo [ABORTED] No files were removed.
    pause
    exit /b 0
)

echo.
echo [CLEANING] Removing temporary folders...

if exist "%~dp0.live-profile" (
    echo   - Deleting .live-profile...
    rd /s /q "%~dp0.live-profile" >nul 2>&1
)

if exist "%~dp0.test-profile" (
    echo   - Deleting .test-profile...
    rd /s /q "%~dp0.test-profile" >nul 2>&1
)

if exist "%~dp0.diag-profile" (
    echo   - Deleting .diag-profile...
    rd /s /q "%~dp0.diag-profile" >nul 2>&1
)

if exist "%~dp0test-results" (
    echo   - Deleting test-results...
    rd /s /q "%~dp0test-results" >nul 2>&1
)

echo.
echo =======================================================================
echo  [SUCCESS] All temporary test profiles and caches purged!
echo  Your extension is now clean, lightweight, and ready for instant loading.
echo =======================================================================
echo.
pause
