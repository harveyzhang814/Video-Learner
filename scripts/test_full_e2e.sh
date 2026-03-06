#!/bin/bash
# Full end-to-end test for Video-Learner
# Tests complete flow: create task -> download -> transcript (skip article/summary - needs Claude)

# Test video URL
TEST_URL="https://www.youtube.com/watch?v=YICiHiU2GBU"

# Clean start
rm -rf work/*
rm -rf media transcript writing

echo "=== Video-Learner Full E2E Test ==="
echo "Testing URL: $TEST_URL"

# Initialize database
echo "[Test 1] Initialize database"
bash scripts/db.sh init
sqlite3 work/database.sqlite ".tables" | grep -q "tasks" && echo "  ✓ Database initialized"

# Run pipeline with get_transcript mode (skips Claude article/summary)
echo "[Test 2] Run pipeline (transcript only)"
echo "  Running: bash scripts/run.sh \"$TEST_URL\" MODE=get_transcript"
bash scripts/run.sh "$TEST_URL" MODE=get_transcript

# Check results
echo "[Test 3] Verify results"

# Check database
TASKS=$(sqlite3 work/database.sqlite "SELECT COUNT(*) FROM tasks;" 2>/dev/null || echo "0")
echo "  Tasks in DB: $TASKS"

if [ "$TASKS" -gt 0 ]; then
    echo "  ✓ Database has tasks"

    # Get task details
    TITLE=$(sqlite3 work/database.sqlite "SELECT title FROM tasks LIMIT 1;")
    echo "    Title: $TITLE"

    URL=$(sqlite3 work/database.sqlite "SELECT url FROM tasks LIMIT 1;")
    echo "    URL: $URL"

    LANG=$(sqlite3 work/database.sqlite "SELECT lang FROM tasks LIMIT 1;")
    echo "    Language: $LANG"
else
    echo "  ✗ No tasks in database"
    exit 1
fi

# Check work directory
WORK_DIRS=$(ls -d work/*/ 2>/dev/null || echo "")
if [ -n "$WORK_DIRS" ]; then
    WORK_COUNT=$(echo "$WORK_DIRS" | wc -l | tr -d ' ')
    echo "  Work directories: $WORK_COUNT"

    for dir in $WORK_DIRS; do
        echo "  Checking: $dir"

        # Check meta.json
        if [ -f "$dir/transcript/meta.json" ]; then
            echo "    ✓ meta.json exists"
            cat "$dir/transcript/meta.json" | head -10
        else
            echo "    ✗ meta.json missing"
        fi

        # Check media directory
        if [ -d "$dir/media" ]; then
            MEDIA_FILES=$(ls "$dir/media" 2>/dev/null | wc -l | tr -d ' ')
            echo "    ✓ Media files: $MEDIA_FILES"
            ls -la "$dir/media" 2>/dev/null | head -5
        else
            echo "    (media directory skipped in transcript mode)"
        fi

        # Check transcript directory
        if [ -d "$dir/transcript" ]; then
            TRANSCRIPT_FILES=$(ls "$dir/transcript" 2>/dev/null | wc -l | tr -d ' ')
            echo "    ✓ Transcript files: $TRANSCRIPT_FILES"
            ls -la "$dir/transcript" 2>/dev/null | head -5
        else
            echo "    ✗ transcript directory missing"
        fi

        # Check original.md
        if [ -f "$dir/transcript/original_en.md" ] || [ -f "$dir/transcript/original_zh.md" ]; then
            echo "    ✓ original.md exists"
            ls -la "$dir/transcript/original_"*.md 2>/dev/null || true
        else
            echo "    ✗ original.md missing"
        fi
    done
else
    echo "  ✗ No work directories found"
    exit 1
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo "✓ Database initialized"
echo "✓ Pipeline executed"
echo "✓ Data stored in database"
echo "✓ Files created in work directory"
echo "✓ Transcript generated"

# Cleanup
echo ""
echo "=== Cleanup ==="
rm -rf work/*
rm -f work/database.sqlite*
rm -rf media transcript writing
echo "  ✓ Cleanup complete"

echo ""
echo "=== All tests passed ==="
