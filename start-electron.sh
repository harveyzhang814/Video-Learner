#!/bin/bash

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR/electron"

# Check and install dependencies if needed
check_deps() {
    local missing=0

    # Check yt-dlp
    if ! command -v yt-dlp &> /dev/null; then
        echo "yt-dlp not found"
        missing=1
    fi

    # Check ffmpeg
    if ! command -v ffmpeg &> /dev/null; then
        echo "ffmpeg not found"
        missing=1
    fi

    # Check jq
    if ! command -v jq &> /dev/null; then
        echo "jq not found"
        missing=1
    fi

    # Check node_modules
    if [ ! -d "$ELECTRON_DIR/node_modules" ]; then
        echo "Electron dependencies not installed"
        missing=1
    fi

    if [ "$missing" = "1" ]; then
        echo "Installing dependencies..."
        bash "$SCRIPT_DIR/scripts/install.sh"
    fi
}

# Run dependency check
check_deps

# Kill existing electron processes (precise match to avoid killing VS Code/Discord/etc.)
pkill -f "${ELECTRON_DIR}/node_modules/.bin/electron" 2>/dev/null
sleep 0.3

# Start electron
cd "$ELECTRON_DIR"
npm start
