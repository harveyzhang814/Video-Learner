'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function getDbPath(rootDir) {
  return path.join(rootDir, 'work', 'database.sqlite');
}

function initTables(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      ts TEXT,
      title TEXT,
      lang TEXT,
      duration TEXT,
      output_lang TEXT DEFAULT 'zh-CN',
      focus TEXT,
      uploader TEXT,
      transcripts TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add uploader if missing
  const _uploaderCols = db.prepare('PRAGMA table_info(tasks)').all();
  if (!_uploaderCols.some((c) => c.name === 'uploader')) {
    db.exec('ALTER TABLE tasks ADD COLUMN uploader TEXT');
  }

  // Migration: add transcripts if missing
  try {
    const columnExists = db
      .prepare('PRAGMA table_info(tasks)')
      .all()
      .some((col) => col.name === 'transcripts');
    if (!columnExists) {
      db.exec(`ALTER TABLE tasks ADD COLUMN transcripts TEXT DEFAULT '{}'`);
    }
  } catch (_) {
    // ignore
  }

  // Migration: add deleted_at for soft delete
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'deleted_at')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN deleted_at TEXT`);
    }
  } catch (_) {
    // ignore
  }

  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'mode')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN mode TEXT DEFAULT 'both'`);
    }
  } catch (_) {
    // ignore
  }

  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'status')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN status TEXT`);
      // NULL default: existing rows use computed status from steps, behavior unchanged
    }
  } catch (_) {
  }

  // Migration: timeout_scale for long-video mode (1 = default, 3 = --long, 6 = --ultra-long)
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'timeout_scale')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN timeout_scale REAL DEFAULT 1`);
    }
  } catch (_) {
    // ignore
  }

  // Migration: media probe fields (width, height, file_size, bit_rate)
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    const names = cols.map((c) => c.name);
    if (!names.includes('width'))     db.exec(`ALTER TABLE tasks ADD COLUMN width INTEGER`);
    if (!names.includes('height'))    db.exec(`ALTER TABLE tasks ADD COLUMN height INTEGER`);
    if (!names.includes('file_size')) db.exec(`ALTER TABLE tasks ADD COLUMN file_size INTEGER`);
    if (!names.includes('bit_rate'))  db.exec(`ALTER TABLE tasks ADD COLUMN bit_rate INTEGER`);
  } catch (_) {
    // ignore
  }

  // Migration: video publish date (YYYY-MM-DD, from yt-dlp upload_date)
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'upload_date')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN upload_date TEXT`);
    }
  } catch (_) {
    // ignore
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      UNIQUE(task_id, step_name)
    )
  `);
}

function createDbManager(dbPath) {
  const db = new Database(dbPath);
  initTables(db);

  return {
    listTasks({ limit = 200 } = {}) {
      const lim = Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.floor(limit))) : 200;
      const rows = db
        .prepare(
          `
          SELECT id, url, ts, title, lang, duration, output_lang, focus, mode, transcripts, uploader, upload_date, created_at, updated_at, width, height, file_size, bit_rate
          FROM tasks WHERE deleted_at IS NULL
          ORDER BY datetime(created_at) DESC, datetime(ts) DESC
          LIMIT ?
        `
        )
        .all(lim);
      for (const r of rows) {
        if (r && r.transcripts) {
          try {
            let parsed = JSON.parse(r.transcripts);
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            r.transcripts = parsed;
          } catch (_) {
            // keep as-is
          }
        }
      }
      return rows;
    },

    createTask(id, url) {
      return db
        .prepare(
          `
          INSERT OR REPLACE INTO tasks (id, url, ts)
          VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
        `
        )
        .run(id, url);
    },

    getTask(id) {
      const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id);
      if (task && task.transcripts) {
        try {
          let parsed = JSON.parse(task.transcripts);
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          task.transcripts = parsed;
        } catch (_) {
          // keep as-is
        }
      }
      return task;
    },

    deleteTask(id) {
      db.pragma('foreign_keys = OFF');
      try {
        const run = db.transaction((taskId) => {
          db.prepare('DELETE FROM steps WHERE task_id = ?').run(taskId);
          db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        });
        run(id);
      } finally {
        db.pragma('foreign_keys = ON');
      }
    },
    softDeleteTask(id) {
      return db.prepare("UPDATE tasks SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ?").run(id);
    },

    updateTask(id, data) {
      const fields = Object.keys(data)
        .map((k) => `${k} = @${k}`)
        .join(', ');
      return db
        .prepare(`UPDATE tasks SET ${fields}, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = @id`)
        .run({ ...data, id });
    },

    updateStep(taskId, stepName, status, error = null) {
      const taskExists = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
      if (!taskExists) {
        db.prepare("INSERT INTO tasks (id, url, ts) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))").run(taskId, '');
      }

      const existing = db
        .prepare('SELECT * FROM steps WHERE task_id = ? AND step_name = ?')
        .get(taskId, stepName);

      if (existing) {
        const attempts = (existing.attempts || 0) + 1;
        return db
          .prepare(
            `
            UPDATE steps SET status = ?, attempts = ?, error = ?,
            started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%f', 'now')),
            completed_at = CASE WHEN ? IN ('completed', 'failed', 'skipped') THEN strftime('%Y-%m-%dT%H:%M:%f', 'now') ELSE completed_at END
            WHERE task_id = ? AND step_name = ?
          `
          )
          .run(status, attempts, error, status, taskId, stepName);
      }

      return db
        .prepare(
          `
          INSERT INTO steps (task_id, step_name, status, attempts, error, started_at)
          VALUES (?, ?, ?, 1, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
        `
        )
        .run(taskId, stepName, status, error);
    },

    /**
     * Set step row exactly (no attempts bump). Used for reset_scope pending resets.
     */
    writeStepState(taskId, stepName, { status, attempts = 0, error = null }) {
      const taskExists = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
      if (!taskExists) {
        db.prepare("INSERT INTO tasks (id, url, ts) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))").run(taskId, '');
      }

      const existing = db.prepare('SELECT * FROM steps WHERE task_id = ? AND step_name = ?').get(taskId, stepName);
      if (existing) {
        return db
          .prepare(
            `
            UPDATE steps SET status = ?, attempts = ?, error = ?,
            started_at = NULL, completed_at = NULL
            WHERE task_id = ? AND step_name = ?
          `
          )
          .run(status, attempts, error, taskId, stepName);
      }

      return db
        .prepare(
          `
          INSERT INTO steps (task_id, step_name, status, attempts, error, started_at)
          VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
        `
        )
        .run(taskId, stepName, status, attempts, error);
    },

    getSteps(taskId) {
      return db.prepare('SELECT * FROM steps WHERE task_id = ?').all(taskId);
    },

    /**
     * Reset any steps left in 'running' state (e.g. from a previous server crash).
     * Also removes corrupted rows where task_id is not a valid 12-char hex ID.
     * Returns the number of steps reset.
     */
    resetStaleRunningSteps() {
      // Remove rows whose task_id is not a valid task ID (e.g. a file path leaked in).
      db.prepare(`
        DELETE FROM steps
        WHERE task_id NOT IN (SELECT id FROM tasks)
      `).run();

      // Reset any steps stuck in 'running' back to 'failed' so they can be retried.
      const result = db.prepare(`
        UPDATE steps
        SET status = 'failed',
            error  = 'Server restarted while step was running'
        WHERE status = 'running'
      `).run();

      return result.changes;
    },

    close() {
      db.close();
    }
  };
}

function createDb(rootDir) {
  const dbPath = getDbPath(rootDir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return createDbManager(dbPath);
}

module.exports = { createDb, getDbPath };
