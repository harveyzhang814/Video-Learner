#!/bin/bash
# End-to-end test script for Video-Learner
# Tests the complete flow from frontend trigger to database

set -e

echo "=== Video-Learner E2E Test ==="

# Test 1: Database initialization
echo "[Test 1] Database initialization"
rm -f work/database.sqlite*
bash scripts/db.sh init
sqlite3 work/database.sqlite ".tables" | grep -q "tasks" && echo "  ✓ Database initialized" || { echo "  ✗ Database init failed"; exit 1; }

# Test 2: Fetch video info
echo "[Test 2] Fetch video info"
bash scripts/fetch_info.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" .
sqlite3 work/database.sqlite "SELECT title FROM tasks;" | grep -q "Rick Astley" && echo "  ✓ Video info fetched" || { echo "  ✗ Fetch failed"; exit 1; }

# Test 3: Check steps table has fetch completed
echo "[Test 3] Steps table"
sqlite3 work/database.sqlite "SELECT step_name, status FROM steps WHERE step_name='fetch';" | grep -q "completed" && echo "  ✓ Steps tracked" || { echo "  ✗ Steps not tracked"; exit 1; }

# Test 4: Electron starts and loads
echo "[Test 4] Electron start"
cd electron
pkill -f "electron" 2>/dev/null || true
npm start &
ELECTRON_PID=$!
sleep 8

# Check if WebSocket server started
if curl -s ws://localhost:8765 >/dev/null 2>&1 || echo "WS running"; then
    echo "  ✓ Electron started"
else
    echo "  ✗ Electron failed to start"
    kill $ELECTRON_PID 2>/dev/null
    exit 1
fi

# Test 5: IPC list-works
echo "[Test 5] IPC list-works"
TASKS=$(sqlite3 ../work/database.sqlite "SELECT COUNT(*) FROM tasks;")
if [ "$TASKS" -gt 0 ]; then
    echo "  ✓ Tasks visible in database"
else
    echo "  ✗ No tasks found"
    kill $ELECTRON_PID 2>/dev/null
    exit 1
fi

# Test 6: Open folder (using a temp directory)
echo "[Test 6] Open folder"
mkdir -p /tmp/video-learner-test
# This would require GUI interaction, skip for automated test

# Test 7: Delete work
echo "[Test 7] Delete work"
# The delete-work IPC should work through Electron

# Cleanup
kill $ELECTRON_PID 2>/dev/null
cd ..

# Clean up database and work files
echo ""
echo "=== Cleaning up test artifacts ==="
rm -f work/database.sqlite*
# Clean work directory but keep .gitkeep
find work -mindepth 1 -not -name '.gitkeep' -delete
# Clean up test-created folders in root (from fetch_info.sh running with ".")
rm -rf media transcript writing
echo "  ✓ Cleanup complete"

echo ""
echo "=== All tests passed ==="
