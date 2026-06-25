# SQLite 迁移设计

## 目标

将任务状态从 meta.json 文件迁移到 SQLite 数据库，实现统一的实时状态管理。

## 技术选型

- **SQLite 库**: better-sqlite3
- **Bash 脚本**: 调用 sqlite3 CLI 写入数据库
- **数据库位置**: `work/database.sqlite`

## 数据库结构

```sql
-- 任务表
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,        -- sha1(url) 前12位
    url TEXT NOT NULL,
    ts TEXT,                    -- ISO 时间戳
    title TEXT,
    lang TEXT,
    duration TEXT,
    output_lang TEXT DEFAULT 'zh-CN',
    focus TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 步骤状态表
CREATE TABLE steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    step_name TEXT NOT NULL,    -- fetch, video, audio, subs, vtt2md, md2vtt, article, summary
    status TEXT DEFAULT 'pending', -- pending, running, completed, failed, skipped
    attempts INTEGER DEFAULT 0,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE(task_id, step_name)
);

-- 下载状态表
CREATE TABLE downloads (
    task_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'pending', -- pending, success, failed, skipped
    attempts INTEGER DEFAULT 0,
    error TEXT,
    file_path TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

## 文件结构

```
electron/
├── src/
│   ├── db.js              # SQLite 封装模块
│   ├── main.js            # 读写 SQLite
│   ├── orchestrator.js    # 读写 SQLite
│   └── ...
scripts/
├── db.sh                  # SQLite 辅助脚本
├── download_video.sh      # 调用 sqlite3 写入状态
├── download_subs.sh      # 调用 sqlite3 写入状态
├── generate_article.sh    # 调用 sqlite3 写入状态
├── generate_summary.sh    # 调用 sqlite3 写入状态
├── fetch_info.sh         # 调用 sqlite3 写入状态
└── ...
work/
└── database.sqlite       # SQLite 数据库文件
```

## 迁移步骤

1. 添加 better-sqlite3 依赖
2. 创建 electron/src/db.js 封装模块
3. 修改 electron/src/main.js 使用 SQLite
4. 修改 electron/src/orchestrator.js 使用 SQLite
5. 创建 scripts/db.sh 辅助脚本
6. 修改各 bash 脚本使用 sqlite3

## 兼容性

- 移除 meta.json，仅使用 SQLite 存储状态
- 外部工具需要适配新的数据库结构
