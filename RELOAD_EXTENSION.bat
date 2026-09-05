@echo off
title Reload Extension in Chrome
echo =========================================================
echo  Opening chrome://extensions in Google Chrome...
echo =========================================================
start chrome "chrome://extensions"
echo.
echo Instructions:
echo 1. Ensure 'Developer mode' is toggled ON in the top-right.
echo 2. Click the 'Reload' (circular arrow) button on the Gmail Mail Merge card.
echo    Or click 'Load unpacked' and select this folder: %~dp0
echo.
pause
