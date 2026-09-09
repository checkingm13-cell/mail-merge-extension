#!/usr/bin/env bash
# cloud/start-cloud-chrome.sh
# Starts Xvfb virtual display, x11vnc server, and Google Chrome with Mail Merge extension loaded.
set -euo pipefail

DISPLAY_NUM=":99"
export DISPLAY="$DISPLAY_NUM"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_DIR="${HOME}/chrome-cloud-profile"

mkdir -p "$PROFILE_DIR"

echo "========================================================"
echo "🌐 Launching 24/7 Cloud Chrome Mail Merge Runner"
echo "   Display       : $DISPLAY_NUM"
echo "   Extension Dir : $EXT_DIR"
echo "   Profile Dir   : $PROFILE_DIR"
echo "========================================================"

# 1. Start Xvfb if not already running on :99
if ! pgrep -f "Xvfb $DISPLAY_NUM" >/dev/null 2>&1; then
    echo "🖥️ Starting Xvfb on display $DISPLAY_NUM..."
    Xvfb "$DISPLAY_NUM" -screen 0 1440x900x24 -ac +extension GLX +render -noreset &
    sleep 2
else
    echo "✔ Xvfb is already running on $DISPLAY_NUM."
fi

# 2. Start x11vnc if not already running
if ! pgrep -f "x11vnc.*$DISPLAY_NUM" >/dev/null 2>&1; then
    echo "📺 Starting x11vnc server on port 5900 (Access via Tailscale VNC)..."
    x11vnc -display "$DISPLAY_NUM" -forever -shared -rfbport 5900 -nopw -bg -o /tmp/x11vnc.log
else
    echo "✔ x11vnc is already running on port 5900."
fi

# 3. Determine Chrome binary
CHROME_BIN="google-chrome"
if ! command -v "$CHROME_BIN" >/dev/null 2>&1; then
    CHROME_BIN="chromium-browser"
    if ! command -v "$CHROME_BIN" >/dev/null 2>&1; then
        CHROME_BIN="chromium"
    fi
fi

echo "🚀 Launching Chrome ($CHROME_BIN) with Mail Merge Extension..."
exec "$CHROME_BIN" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    --window-size=1440,900 \
    --start-maximized \
    --user-data-dir="$PROFILE_DIR" \
    --load-extension="$EXT_DIR" \
    --disable-features=Translate \
    --remote-debugging-port=9222 \
    --no-first-run \
    --no-default-browser-check \
    "https://mail.google.com/"
