@echo off
title Live Gmail Automation Test
echo =========================================================
echo  Running Live Gmail Mail Merge Test (Safe Dry Run)
echo =========================================================
cd /d "%~dp0"

node test-live-gmail.js

echo.
echo =========================================================
echo  Test finished. Opening test-results screenshot folder...
echo =========================================================
start explorer "%~dp0test-results"
pause
