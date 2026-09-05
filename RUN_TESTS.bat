@echo off
title Extension E2E Test Runner
echo =========================================================
echo  Running Gmail Extension End-to-End Automated Test Suite
echo =========================================================
cd /d "%~dp0"

node e2e-test.js

echo.
echo =========================================================
echo  Test finished. Opening test-results screenshot folder...
echo =========================================================
start explorer "%~dp0test-results"
pause
