#!/bin/bash

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR/electron"

# Kill existing electron processes
pkill -f "electron" 2>/dev/null
killall Electron 2>/dev/null
sleep 0.3

# Start electron
cd "$ELECTRON_DIR"
npm start
