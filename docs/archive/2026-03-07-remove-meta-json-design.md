# Remove meta.json Design

Date: 2026-03-07

## Goal

Remove dependency on `meta.json` file, store all data in SQLite database.

## Current State

### Database Schema (Existing)
- **tasks**: id, url, ts, title, lang, duration, output_lang, focus
- **downloads**: task_id, status, attempts, error, file_path
- **steps**: id, task_id, step_name, status, attempts, error, started_at, completed_at

### meta.json Fields (To Remove)
- `transcript_done` → use steps table
- `article_done` → use steps table
- `summary_done` → use steps table
- `transcript_source` → remove (debug only)
- `article_prompt_path` → remove (debug only)
- `tool_versions` → remove (debug only)
- `transcripts` → migrate to tasks table

## Changes Required

### 1. Database Schema Changes
Add `transcripts` JSON column to tasks table:
```sql
ALTER TABLE tasks ADD COLUMN transcripts TEXT DEFAULT '{}';
```

### 2. Electron Backend (electron/src/db.js)
- Add `transcripts` field to task model
- Add `updateTranscripts(id, data)` method to store {en: bool, zh: bool}

### 3. Electron Backend (electron/src/orchestrator.js)
- After subs step completes, save transcripts info to DB
- Remove all references to meta.json

### 4. Electron Frontend (electron/src/main.js)
- `get-available-subtitles` IPC: read from database instead of meta.json
- `get-task-details` IPC: use steps table for done status

### 5. Scripts (Remove meta.json writes)
- scripts/fetch_info.sh: write to database instead of meta.json
- scripts/download_video.sh: remove meta.json updates
- scripts/run.sh: remove meta.json reads/writes

### 6. Cleanup
- Delete scripts/meta_utils.py (no longer needed)
- Remove work/*/transcript/meta.json files

## Implementation Order

1. Add `transcripts` column to database
2. Update orchestrator to write transcripts to DB
3. Update Electron IPC to read from DB
4. Remove meta.json from scripts
5. Clean up existing meta.json files
