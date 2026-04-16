# SQLite 迁移实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**目标:** 将任务状态从 meta.json 文件迁移到 SQLite 数据库

**架构:** Electron 使用 better-sqlite3，Bash 脚本调用 sqlite3 CLI，数据库文件存放在 work/database.sqlite

**技术栈:** better-sqlite3, sqlite3 CLI, Node.js

---

## Task 1: 添加 better-sqlite3 依赖

**Files:**
- Modify: `electron/package.json`

**Step 1: 安装依赖**

```bash
cd electron && npm install better-sqlite3
```

**Step 2: 验证安装**

```bash
cd electron && npm list better-sqlite3
# Expected: better-sqlite3@x.x.x in node_modules
```

**Step 3: Commit**

```bash
git add electron/package.json electron/package-lock.json
git commit -m "feat: add better-sqlite3 dependency"
```

---

## Task 2: 创建 SQLite 封装模块

**Files:**
- Create: `electron/src/db.js`

**Step 1: 创建 db.js 模块**

```javascript
// electron/src/db.js
const Database = require('better-sqlite3');
const path = require('path');

class Database {
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
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
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
        return stmt.get(id);
    }

    updateTask(id, data) {
        const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        const stmt = this.db.prepare(`UPDATE tasks SET ${fields}, updated_at = datetime('now') WHERE id = @id`);
        return stmt.run({ ...data, id });
    }

    // 步骤操作
    updateStep(taskId, stepName, status, error = null) {
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

module.exports = Database;
```

**Step 2: Commit**

```bash
git add electron/src/db.js
git commit -m "feat: add SQLite database module

- Tables: tasks, steps, downloads
- CRUD operations for tasks and steps"
```

---

## Task 3: 修改 main.js 使用 SQLite

**Files:**
- Modify: `electron/src/main.js`

**Step 1: 添加 Database 引用**

在文件顶部添加：
```javascript
const Database = require('./db');
```

**Step 2: 初始化数据库**

在变量声明区域添加：
```javascript
let db;
const DB_PATH = path.join(__dirname, '../..', 'work', 'database.sqlite');
```

在 createWindow 函数中添加：
```javascript
// 初始化数据库
db = new Database(DB_PATH);
```

**Step 3: 修改 IPC 处理器使用数据库**

修改 list-works:
```javascript
ipcMain.handle('list-works', async () => {
    try {
        const tasks = db.listTasks();
        return tasks.map(t => ({
            id: t.id,
            title: t.title || 'Untitled',
            ts: t.ts,
            status: t.download_status === 'success' ? 'completed' :
                    t.download_status === 'failed' ? 'failed' : 'running'
        }));
    } catch (e) {
        return [];
    }
});
```

**Step 4: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: integrate SQLite in main.js

- Database initialization
- list-works uses database"
```

---

## Task 4: 修改 orchestrator.js 使用 SQLite

**Files:**
- Modify: `electron/src/orchestrator.js`

**Step 1: 添加 Database 引用**

在文件顶部添加：
```javascript
const Database = require('./db');
```

**Step 2: 修改构造函数**

```javascript
class Orchestrator {
    constructor(baseDir, onOutput, onTaskCreated, onTaskUpdated, onStepEvent) {
        this.baseDir = baseDir;
        this.onOutput = onOutput;
        this.onTaskCreated = onTaskCreated;
        this.onTaskUpdated = onTaskUpdated;
        this.onStepEvent = onStepEvent;

        // 初始化数据库
        const dbPath = path.join(baseDir, 'work', 'database.sqlite');
        this.db = new Database(dbPath);
    }
```

**Step 3: 修改 createTask/createMeta 方法**

将 getMeta/saveMeta 改为使用数据库：
```javascript
getMeta(id) {
    return this.db.getTask(id);
}

saveMeta(id, meta) {
    // 更新任务表
    this.db.updateTask(id, {
        url: meta.url,
        title: meta.title,
        lang: meta.lang,
        duration: meta.duration,
        output_lang: meta.output_lang,
        focus: meta.focus
    });
}
```

**Step 4: 修改 runStep 使用数据库更新步骤状态**

在 runStep 开始时：
```javascript
this.db.updateStep(id, stepName, 'running');
if (this.onStepEvent) {
    this.onStepEvent('task:status', { id, currentStep: stepName, stepStatus: 'running' });
}
```

在 runStep 成功时：
```javascript
this.db.updateStep(id, stepName, 'completed');
if (this.onStepEvent) {
    this.onStepEvent('task:status', { id, currentStep: stepName, stepStatus: 'completed' });
}
```

在 runStep 失败时：
```javascript
this.db.updateStep(id, stepName, 'failed', errorMsg);
if (this.onStepEvent) {
    this.onStepEvent('task:error', { id, step: stepName, error: errorMsg });
}
```

**Step 5: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "feat: migrate orchestrator to use SQLite

- Database operations for task and step status
- Real-time status updates via onStepEvent"
```

---

## Task 5: 创建 Bash SQLite 辅助脚本

**Files:**
- Create: `scripts/db.sh`

**Step 1: 创建 db.sh**

```bash
#!/bin/bash
# scripts/db.sh - SQLite helper functions

DB_PATH="${1:-./work/database.sqlite}"

# 初始化数据库表
init_db() {
    sqlite3 "$DB_PATH" "
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            ts TEXT,
            title TEXT,
            lang TEXT,
            duration TEXT,
            output_lang TEXT DEFAULT 'zh-CN',
            focus TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

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
        );

        CREATE TABLE IF NOT EXISTS downloads (
            task_id TEXT PRIMARY KEY,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            error TEXT,
            file_path TEXT,
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        );
    "
}

# 创建任务
create_task() {
    local id="$1"
    local url="$2"
    sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO tasks (id, url, ts) VALUES ('$id', '$url', datetime('now'));"
}

# 更新任务
update_task() {
    local id="$1"
    shift
    local updates=""
    while [ $# -gt 0 ]; do
        updates="$updates $1"
        shift
    done
    sqlite3 "$DB_PATH" "UPDATE tasks SET $updates, updated_at = datetime('now') WHERE id = '$id';"
}

# 更新步骤状态
update_step() {
    local task_id="$1"
    local step_name="$2"
    local status="$3"
    local error="${4:-}"

    # 检查是否存在
    local exists=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM steps WHERE task_id='$task_id' AND step_name='$step_name';")

    if [ "$exists" -eq "0" ]; then
        sqlite3 "$DB_PATH" "INSERT INTO steps (task_id, step_name, status, attempts, started_at) VALUES ('$task_id', '$step_name', '$status', 1, datetime('now'));"
    else
        sqlite3 "$DB_PATH" "UPDATE steps SET status = '$status', attempts = attempts + 1, error = '$error', completed_at = CASE WHEN '$status' IN ('completed', 'failed', 'skipped') THEN datetime('now') ELSE completed_at END WHERE task_id = '$task_id' AND step_name = '$step_name';"
    fi
}

# 更新下载状态
update_download() {
    local task_id="$1"
    local status="$2"
    local error="${3:-}"
    local file_path="${4:-}"

    local exists=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM downloads WHERE task_id='$task_id';")

    if [ "$exists" -eq "0" ]; then
        sqlite3 "$DB_PATH" "INSERT INTO downloads (task_id, status, attempts, error) VALUES ('$task_id', '$status', 1, '$error');"
    else
        sqlite3 "$DB_PATH" "UPDATE downloads SET status = '$status', attempts = attempts + 1, error = '$error', file_path = '$file_path' WHERE task_id = '$task_id';"
    fi
}

# 获取任务
get_task() {
    local id="$1"
    sqlite3 -json "$DB_PATH" "SELECT * FROM tasks WHERE id = '$id';"
}

# 获取步骤
get_steps() {
    local task_id="$1"
    sqlite3 -json "$DB_PATH" "SELECT * FROM steps WHERE task_id = '$task_id';"
}

# 主命令
case "$1" in
    init)
        init_db
        ;;
    create-task)
        create_task "$2" "$3"
        ;;
    update-step)
        update_step "$2" "$3" "$4" "$5"
        ;;
    update-download)
        update_download "$2" "$3" "$4" "$5"
        ;;
    get-task)
        get_task "$2"
        ;;
    get-steps)
        get_steps "$2"
        ;;
esac
```

**Step 2: 添加执行权限并 Commit**

```bash
chmod +x scripts/db.sh
git add scripts/db.sh
git commit -m "feat: add SQLite helper script for bash

- init, create-task, update-step, update-download commands
- Works with work/database.sqlite"
```

---

## Task 6: 修改 Bash 脚本使用 SQLite

**Files:**
- Modify: `scripts/fetch_info.sh`, `scripts/download_video.sh`, `scripts/download_subs.sh`, `scripts/generate_article.sh`, `scripts/generate_summary.sh`

**Step 1: 修改 fetch_info.sh**

在脚本开头添加数据库初始化（如果没有）:
```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/work/database.sqlite"

# 初始化数据库表（首次）
sqlite3 "$DB_PATH" "
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        ts TEXT,
        title TEXT,
        lang TEXT,
        duration TEXT,
        output_lang TEXT DEFAULT 'zh-CN',
        focus TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
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
    );
    CREATE TABLE IF NOT EXISTS downloads (
        task_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error TEXT,
        file_path TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
" 2>/dev/null || true
```

在获取视频信息后更新数据库：
```bash
# 创建任务记录
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO tasks (id, url, ts, title, lang, duration) VALUES ('$ID', '$URL', datetime('now'), '$TITLE', '$LANG', '$DURATION');"

# 更新步骤状态为完成
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO steps (task_id, step_name, status, attempts, started_at, completed_at) VALUES ('$ID', 'fetch', 'completed', 1, datetime('now'), datetime('now'));"
```

**Step 2: 修改 download_video.sh**

添加类似的数据库初始化和状态更新：
```bash
# 开始下载时
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO downloads (task_id, status, attempts) VALUES ('$ID', 'running', 1);"

# 下载成功时
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO downloads (task_id, status, attempts, file_path) VALUES ('$ID', 'success', 1, '$OUTPUT');"
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO steps (task_id, step_name, status, attempts, started_at, completed_at) VALUES ('$ID', 'video', 'completed', 1, datetime('now'), datetime('now'));"

# 下载失败时
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO downloads (task_id, status, attempts, error) VALUES ('$ID', 'failed', 2, '$ERROR');"
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO steps (task_id, step_name, status, attempts, error, started_at, completed_at) VALUES ('$ID', 'video', 'failed', 1, '$ERROR', datetime('now'), datetime('now'));"
```

**Step 3: 修改其他脚本 (download_subs.sh, generate_article.sh, generate_summary.sh)**

类似地添加：
- 数据库初始化
- 步骤开始/完成/失败的状态更新

**Step 4: Commit**

```bash
git add scripts/fetch_info.sh scripts/download_video.sh scripts/download_subs.sh scripts/generate_article.sh scripts/generate_summary.sh
git commit -m "feat: migrate bash scripts to use SQLite

- All scripts now write to database instead of meta.json
- Real-time status tracking via SQLite"
```

---

## Task 7: 清理 meta.json 相关代码

**Files:**
- Modify: `electron/src/main.js`, `electron/src/orchestrator.js`

**Step 1: 移除 meta.json 相关代码**

检查并移除以下内容：
- getMeta/saveMeta 方法（已改为数据库）
- metaPath 相关的文件读取/写入逻辑

**Step 2: Commit**

```bash
git add electron/src/main.js electron/src/orchestrator.js
git commit -m "refactor: remove meta.json references

- All state now in SQLite database"
```

---

## 总结

实现计划包含 7 个任务：

1. 添加 better-sqlite3 依赖
2. 创建 SQLite 封装模块 (db.js)
3. 修改 main.js 使用 SQLite
4. 修改 orchestrator.js 使用 SQLite
5. 创建 Bash SQLite 辅助脚本
6. 修改 Bash 脚本使用 SQLite
7. 清理 meta.json 相关代码
