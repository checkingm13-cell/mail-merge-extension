#!/usr/bin/env bash
# cloud/setup-cloud-chrome.sh
# Turnkey setup for 24/7 Chrome Extension Runner on Oracle Cloud Ubuntu VPS
set -euo pipefail

echo "========================================================"
echo "🚀 Setting up 24/7 Cloud Chrome Extension Runner"
echo "========================================================"

# 1. Update and install base dependencies
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends \
    wget \
    curl \
    git \
    xvfb \
    x11vnc \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libgbm1 \
    libnss3

# 2. Install official Google Chrome Stable (or Chromium for ARM64)
ARCH="$(uname -m)"
echo "Detected architecture: $ARCH"

if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    if [ "$ARCH" = "x86_64" ]; then
        echo "⬇️ Downloading and installing Google Chrome Stable (AMD64)..."
        wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
        sudo dpkg -i /tmp/google-chrome.deb || sudo apt-get install -fy
        rm -f /tmp/google-chrome.deb
    else
        echo "📦 Installing Chromium for ARM64 (Ampere A1)..."
        sudo apt-get install -y chromium-browser
    fi
else
    echo "✔ Chrome/Chromium is already installed."
fi

# 3. Install Node.js LTS and PM2 if not present
if ! command -v node >/dev/null 2>&1; then
    echo "📦 Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "📦 Installing PM2 globally..."
    sudo npm install -g pm2
fi

# 4. Make cloud scripts executable
chmod +x "$(dirname "$0")/start-cloud-chrome.sh" || true

echo "========================================================"
echo "✅ Oracle Cloud VPS Setup Complete!"
echo "Next step: Run './cloud/start-cloud-chrome.sh' or 'pm2 start cloud/ecosystem.config.js'"
echo "========================================================"
