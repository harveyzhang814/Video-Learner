// electron/src/db.js
const Database = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.initTables();
    }

    initTables() {
        // 创建任务表
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

        // 迁移：为旧数据库添加缺失的列
        try {
            const columnExists = this.db.prepare("PRAGMA table_info(tasks)").all()
                .some(col => col.name === 'transcripts');
            if (!columnExists) {
                this.db.exec(`ALTER TABLE tasks ADD COLUMN transcripts TEXT DEFAULT '{}'`);
            }
        } catch (e) {
            // 忽略迁移错误（列可能已存在）
        }

        // 创建步骤状态表
        this.db.exec(`
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

        // 创建下载状态表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS downloads (
                task_id TEXT PRIMARY KEY,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                error TEXT,
                file_path TEXT,
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            )
        `);
    }

    // 任务操作
    createTask(id, url) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO tasks (id, url, ts)
            VALUES (?, ?, datetime('now'))
        `);
        return stmt.run(id, url);
    }

    getTask(id) {
        const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
        const task = stmt.get(id);
        if (task && task.transcripts) {
            try {
                // Parse transcripts JSON string to object
                let parsed = JSON.parse(task.transcripts);
                // Handle double-serialized strings (legacy bug)
                if (typeof parsed === 'string') {
                    parsed = JSON.parse(parsed);
                }
                task.transcripts = parsed;
            } catch {
                // Keep as-is if parsing fails
            }
        }
        return task;
    }

    updateTask(id, data) {
        const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        const stmt = this.db.prepare(`UPDATE tasks SET ${fields}, updated_at = datetime('now') WHERE id = @id`);
        return stmt.run({ ...data, id });
    }

    // 更新 transcripts 信息
    updateTranscripts(id, data) {
        // 如果已经是字符串，直接使用；否则序列化对象
        const transcriptsJson = typeof data === 'string' ? data : JSON.stringify(data);
        const stmt = this.db.prepare(`
            UPDATE tasks SET transcripts = ?, updated_at = datetime('now') WHERE id = ?
        `);
        return stmt.run(transcriptsJson, id);
    }

    // 获取 transcripts 信息
    getTranscripts(id) {
        const stmt = this.db.prepare('SELECT transcripts FROM tasks WHERE id = ?');
        const result = stmt.get(id);
        if (result && result.transcripts) {
            try {
                // Handle double-serialized JSON (legacy bug)
                let parsed = JSON.parse(result.transcripts);
                if (typeof parsed === 'string') {
                    parsed = JSON.parse(parsed);
                }
                return parsed;
            } catch {
                return {};
            }
        }
        return {};
    }

    // 步骤操作
    updateStep(taskId, stepName, status, error = null) {
        // Ensure task exists first (to satisfy foreign key)
        const taskExists = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
        if (!taskExists) {
            this.db.prepare('INSERT INTO tasks (id, url, ts) VALUES (?, ?, datetime(\'now\'))').run(taskId, '');
        }

        const existing = this.db.prepare(
            'SELECT * FROM steps WHERE task_id = ? AND step_name = ?'
        ).get(taskId, stepName);

        if (existing) {
            const attempts = existing.attempts + 1;
            const stmt = this.db.prepare(`
                UPDATE steps SET status = ?, attempts = ?, error = ?,
                started_at = COALESCE(started_at, datetime('now')),
                completed_at = CASE WHEN ? IN ('completed', 'failed', 'skipped') THEN datetime('now') ELSE completed_at END
                WHERE task_id = ? AND step_name = ?
            `);
            return stmt.run(status, attempts, error, status, taskId, stepName);
        } else {
            const stmt = this.db.prepare(`
                INSERT INTO steps (task_id, step_name, status, attempts, error, started_at)
                VALUES (?, ?, ?, 1, ?, datetime('now'))
            `);
            return stmt.run(taskId, stepName, status, error);
        }
    }

    getSteps(taskId) {
        const stmt = this.db.prepare('SELECT * FROM steps WHERE task_id = ?');
        return stmt.all(taskId);
    }

    // 下载操作
    updateDownload(taskId, status, error = null, filePath = null) {
        // Ensure task exists first (to satisfy foreign key)
        const taskExists = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
        if (!taskExists) {
            this.db.prepare('INSERT INTO tasks (id, url, ts) VALUES (?, ?, datetime(\'now\'))').run(taskId, '');
        }

        const existing = this.db.prepare('SELECT * FROM downloads WHERE task_id = ?').get(taskId);

        if (existing) {
            const stmt = this.db.prepare(`
                UPDATE downloads SET status = ?, attempts = attempts + 1, error = ?, file_path = ?
                WHERE task_id = ?
            `);
            return stmt.run(status, error, filePath, taskId);
        } else {
            const stmt = this.db.prepare(`
                INSERT INTO downloads (task_id, status, attempts, error, file_path)
                VALUES (?, ?, 1, ?, ?)
            `);
            return stmt.run(taskId, status, error, filePath);
        }
    }

    getDownload(taskId) {
        return this.db.prepare('SELECT * FROM downloads WHERE task_id = ?').get(taskId);
    }

    // 查询所有任务
    listTasks() {
        return this.db.prepare(`
            SELECT t.*, d.status as download_status
            FROM tasks t
            LEFT JOIN downloads d ON t.id = d.task_id
            ORDER BY t.ts DESC
        `).all();
    }

    close() {
        this.db.close();
    }
}

module.exports = DatabaseManager;
