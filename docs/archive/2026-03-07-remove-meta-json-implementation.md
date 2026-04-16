# Remove meta.json Implementation Plan

> **For REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Remove dependency on `meta.json` file, store all data in SQLite database.

**Architecture:** Add `transcripts` JSON column to tasks table. Use steps table to determine task completion status (already implemented). Remove all meta.json reads/writes from scripts.

**Tech Stack:** Electron, better-sqlite3, bash scripts

---

## Task 1: Add transcripts column to database schema

**Files:**
- Modify: `electron/src/db.js:14-29`

**Step 1: Add transcripts column to tasks table**

In `electron/src/db.js`, find the `initTables()` method and update the tasks table creation:

```javascript
// 修改 tasks 表定义，添加 transcripts 字段
this.db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        ts TEXT,
        title TEXT,
        lang TEXT,
        duration TEXT,
        output_lang TEXT DEFAULT 'zh-CN',
        focus TEXT,
        transcripts TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);
```

**Step 2: Add updateTranscripts method**

After line 77 (after `updateTask` method), add:

```javascript
// 更新 transcripts 信息
updateTranscripts(id, data) {
    const transcriptsJson = JSON.stringify(data);
    const stmt = this.db.prepare(`
        UPDATE tasks SET transcripts = ?, updated_at = datetime('now') WHERE id = ?
    `);
    return stmt.run(transcriptsJson, id);
}
```

**Step 3: Add getTranscripts method**

After `updateTranscripts`, add:

```javascript
// 获取 transcripts 信息
getTranscripts(id) {
    const stmt = this.db.prepare('SELECT transcripts FROM tasks WHERE id = ?');
    const result = stmt.get(id);
    if (result && result.transcripts) {
        try {
            return JSON.parse(result.transcripts);
        } catch {
            return {};
        }
    }
    return {};
}
```

**Step 4: Commit**

```bash
git add electron/src/db.js
git commit -m "feat: add transcripts column and methods to database"
```

---

## Task 2: Update orchestrator to save transcripts to DB

**Files:**
- Modify: `electron/src/orchestrator.js:58-78`

**Step 1: Modify saveMeta to handle transcripts**

Update the `saveMeta` method to also save transcripts:

```javascript
// 保存任务到数据库
saveMeta(id, meta) {
    // If title or duration is empty in meta, preserve existing values from DB
    let title = meta.title;
    let duration = meta.duration;
    if (!title || !duration) {
        const existing = this.db.getTask(id);
        if (existing) {
            title = title || existing.title;
            duration = duration || existing.duration;
        }
    }

    // Prepare update data
    const updateData = {
        url: meta.url,
        title: title,
        lang: meta.lang,
        duration: duration,
        output_lang: meta.output_lang,
        focus: meta.focus
    };

    // Save transcripts if provided
    if (meta.transcripts) {
        this.db.updateTranscripts(id, meta.transcripts);
    }

    // 更新任务表
    this.db.updateTask(id, updateData);
}
```

**Step 2: Add logic to save transcripts after subs step**

Find where subs step completes (around line 293) and add transcript detection:

```javascript
// 在 subs 步骤完成后，检测并保存字幕信息
if (stepName === 'subs' || stepName === 'vtt2md') {
    const subsDir = path.join(dir, 'transcript', 'subs');
    const enVtt = path.join(subsDir, 'en.vtt');
    const zhVtt = path.join(subsDir, 'zh.vtt');
    const enMd = path.join(dir, 'transcript', 'original_en.md');
    const zhMd = path.join(dir, 'transcript', 'original_zh.md');

    const transcripts = {
        en: fs.existsSync(enMd) || fs.existsSync(enVtt),
        zh: fs.existsSync(zhMd) || fs.existsSync(zhVtt)
    };

    // Save to database
    this.db.updateTranscripts(id, transcripts);

    // Also update in-memory meta
    meta.transcripts = transcripts;
}
```

**Step 3: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "feat: save transcripts info to database after subs step"
```

---

## Task 3: Update get-available-subtitles IPC to read from DB

**Files:**
- Modify: `electron/src/main.js:511-556`

**Step 1: Update get-available-subtitles**

Replace the current implementation to read from database:

```javascript
// Get available subtitles
ipcMain.handle('get-available-subtitles', async (event, id) => {
  const fs = require('fs').promises;
  const path = require('path');

  try {
    // Get transcripts from database
    const transcripts = db ? db.getTranscripts(id) : {};

    // Check article source language from tasks table
    const task = db ? db.getTask(id) : null;

    // Return transcripts info from database
    return {
      en: transcripts.en || null,
      zh: transcripts.zh || null,
      articleSource: task ? task.article_source_lang || null : null
    };
  } catch (e) {
    console.error('get-available-subtitles error:', e);
    return { en: null, zh: null, articleSource: null };
  }
});
```

**Step 2: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: read transcripts from database instead of meta.json"
```

---

## Task 4: Remove meta.json writes from fetch_info.sh

**Files:**
- Modify: `scripts/fetch_info.sh:40-85`

**Step 1: Update fetch_info.sh to write to database**

Replace the meta.json writing logic with database update. The script already calls orchestrator API, so we need to check how it updates the database. Look at the current script:

Current logic writes to `$DIR/transcript/meta.json`. We need to remove this file write.

**Step 2: Remove meta.json file creation**

Find and remove these lines in fetch_info.sh:
- Line 40: `META_FILE="$DIR/transcript/meta.json"`
- Lines 66-77: meta.json create/update logic

Keep the echo statements for logging but remove file writes.

**Step 3: Commit**

```bash
git add scripts/fetch_info.sh
git commit -m "refactor: remove meta.json writes from fetch_info.sh"
```

---

## Task 5: Remove meta.json writes from download_video.sh

**Files:**
- Modify: `scripts/download_video.sh:40-89`

**Step 1: Remove meta.json updates**

Remove all jq commands that update meta.json:
- Lines 40-41: download_status = "skipped_existing"
- Lines 59-60: download_status = "success" (video)
- Lines 76-77: download_status = "success" (audio)
- Line 88-89: download_status = "failed"

These updates are already stored in the downloads table via orchestrator.

**Step 2: Commit**

```bash
git add scripts/download_video.sh
git commit -m "refactor: remove meta.json updates from download_video.sh"
```

---

## Task 6: Remove meta.json from run.sh

**Files:**
- Modify: `scripts/run.sh`

**Step 1: Remove all meta.json reads**

Search and remove:
- Line 94-99: Reading from meta.json for existing task
- Line 121-123: Loading existing meta.json

**Step 2: Remove all meta.json writes**

Search and remove:
- Line 161: `echo "$META" > "$DIR/transcript/meta.json"`
- Line 186: `echo "$META" > "$DIR/transcript/meta.json"`
- Line 202: `echo "$META" > "$DIR/transcript/meta.json"`
- Line 568: `echo "$META" > "$DIR/transcript/meta.json"`

**Step 3: Remove meta.json merge logic**

Lines 558-567 merge with existing meta.json - remove this logic.

**Step 4: Commit**

```bash
git add scripts/run.sh
git commit -m "refactor: remove all meta.json operations from run.sh"
```

---

## Task 7: Clean up existing meta.json files

**Files:**
- Bash command to clean up

**Step 1: Find and remove all meta.json files**

```bash
find work -name "meta.json" -type f -delete
```

**Step 2: Commit**

```bash
git add -A
git commit -m "cleanup: remove all existing meta.json files"
```

---

## Task 8: Delete meta_utils.py

**Files:**
- Delete: `scripts/meta_utils.py`

**Step 1: Remove the file**

```bash
rm scripts/meta_utils.py
```

**Step 2: Commit**

```bash
git add -A
git commit -m "cleanup: remove unused meta_utils.py"
```

---

## Verification

After implementing all tasks:

1. Run a test task: `bash scripts/run.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
2. Check database: `sqlite3 work/database.sqlite "SELECT * FROM tasks;"`
3. Verify no meta.json exists: `find work -name "meta.json"`
4. Test Electron app loads correctly

---

**Plan complete and saved to `docs/plans/2026-03-07-remove-meta-json-implementation.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
