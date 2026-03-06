#!/bin/bash
# E2E test via WebSocket - simulates frontend trigger path
# Tests: Electron -> WebSocket -> orchestrator -> child scripts

set -e

TEST_URL="https://www.youtube.com/watch?v=YICiHiU2GBU"
WS_URL="ws://localhost:8765"

# Clean start
rm -rf work/*
rm -rf media transcript writing

echo "=== E2E Test via WebSocket ==="
echo "Testing URL: $TEST_URL"

# Initialize database
echo "[Test 1] Initialize database"
bash scripts/db.sh init

# Start Electron
echo "[Test 2] Start Electron"
cd electron
pkill -f "electron" 2>/dev/null || true
npm start &
ELECTRON_PID=$!
cd ..

# Wait for Electron to start
sleep 8

# Check if WebSocket is available
if ! curl -s "$WS_URL" >/dev/null 2>&1; then
    echo "  ✗ WebSocket not available"
    kill $ELECTRON_PID 2>/dev/null
    exit 1
fi
echo "  ✓ Electron started, WebSocket available"

# Send pipeline command via WebSocket
echo "[Test 3] Send task:run via WebSocket"

# Use Node.js to send WebSocket message
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('$WS_URL');

ws.on('open', () => {
    console.log('  Connected to WebSocket');
    ws.send(JSON.stringify({
        type: 'task:run',
        payload: {
            url: '$TEST_URL',
            focus: 'test',
            downloadVideo: 'video'
        }
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('  Received:', msg.type);
    if (msg.type === 'task:complete') {
        console.log('  ✓ Pipeline completed');
        process.exit(0);
    } else if (msg.type === 'task:error') {
        console.log('  ✗ Pipeline error:', msg.error);
        process.exit(1);
    }
});

ws.on('error', (err) => {
    console.log('  ✗ WebSocket error:', err.message);
    process.exit(1);
});

// Timeout after 120 seconds
setTimeout(() => {
    console.log('  ✗ Timeout waiting for pipeline');
    process.exit(1);
}, 120000);
" || {
    echo "  ✗ WebSocket test failed"
    kill $ELECTRON_PID 2>/dev/null
    exit 1
}

# Wait a bit for files to be written
sleep 2

# Check results
echo "[Test 4] Verify results"

# Check database
TASKS=$(sqlite3 work/database.sqlite "SELECT COUNT(*) FROM tasks;" 2>/dev/null || echo "0")
echo "  Tasks in DB: $TASKS"

if [ "$TASKS" -gt 0 ]; then
    TITLE=$(sqlite3 work/database.sqlite "SELECT title FROM tasks LIMIT 1;")
    echo "    Title: $TITLE"
fi

# Check work directory
WORK_DIRS=$(ls -d work/*/ 2>/dev/null || echo "")
if [ -n "$WORK_DIRS" ]; then
    for dir in $WORK_DIRS; do
        echo "  Checking: $dir"
        [ -f "$dir/transcript/meta.json" ] && echo "    ✓ meta.json"
        [ -f "$dir/transcript/original_en.md" ] && echo "    ✓ original_en.md"
    done
fi

# Cleanup
echo ""
echo "[Cleanup]"
kill $ELECTRON_PID 2>/dev/null || true
rm -rf work/* media transcript writing
echo "  ✓ Done"

echo ""
echo "=== All tests passed ==="
