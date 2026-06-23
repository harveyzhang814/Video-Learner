#!/bin/bash
# scripts/db.sh - SQLite helper functions for bash scripts

# 检查是否被 sourced（如果是，参数是继承的，不使用 $1）
_is_sourced() {
    [[ "${BASH_SOURCE[0]}" != "${0}" ]]
}

# 检查参数是否为命令
_is_command() {
    local cmd="$1"
    [[ "$cmd" == "init" ]] || [[ "$cmd" == "create-task" ]] || \
    [[ "$cmd" == "update-step" ]] || [[ "$cmd" == "update-download" ]] || \
    [[ "$cmd" == "get-task" ]] || [[ "$cmd" == "get-steps" ]]
}

_db_sh_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if _is_sourced; then
    # 被 sourced：用 work_dir.sh 解析默认 DB_PATH
    source "$_db_sh_dir/work_dir.sh"
elif _is_command "${1:-}"; then
    source "$_db_sh_dir/work_dir.sh"
else
    DB_PATH="${1:-}"
    if [ -z "$DB_PATH" ]; then
        source "$_db_sh_dir/work_dir.sh"
    fi
fi

# 获取脚本所在目录（处理 sourced 的情况）
_get_script_dir() {
    if [ -n "${BASH_SOURCE[0]}" ]; then
        local script="${BASH_SOURCE[0]}"
    else
        local script="$0"
    fi
    cd "$(dirname "$script")" && pwd
}

# 确保数据库路径是绝对路径
if [[ "$DB_PATH" != /* ]]; then
    SCRIPT_DIR="$(_get_script_dir)"
    # 如果 SCRIPT_DIR 是 scripts/xxx，则取父目录
    if [[ "$SCRIPT_DIR" == */scripts ]]; then
        PROJECT_DIR="${SCRIPT_DIR%/scripts}"
    else
        PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    fi
    DB_PATH="$PROJECT_DIR/$DB_PATH"
fi

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
    # Migrations: add columns that may be missing from older databases
    sqlite3 "$DB_PATH" "ALTER TABLE tasks ADD COLUMN uploader TEXT;" 2>/dev/null || true
    sqlite3 "$DB_PATH" "ALTER TABLE tasks ADD COLUMN upload_date TEXT;" 2>/dev/null || true
}

# Escape a string for safe SQLite single-quoted interpolation (doubles all ' chars)
_sq() { printf '%s' "$1" | sed "s/'/''/g"; }

# 创建任务
create_task() {
    local id="$1"
    local url="$2"
    sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO tasks (id, url, ts) VALUES ('$(_sq "$id")', '$(_sq "$url")', datetime('now'));"
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
    sqlite3 "$DB_PATH" "UPDATE tasks SET $updates, updated_at = datetime('now') WHERE id = '$(_sq "$id")';"
}

# 更新步骤状态
update_step() {
    local task_id="$1"
    local step_name="$2"
    local status="$3"
    local error="${4:-}"

    # 检查是否存在
    local exists=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM steps WHERE task_id='$(_sq "$task_id")' AND step_name='$(_sq "$step_name")';" )

    if [ "$exists" -eq "0" ]; then
        sqlite3 "$DB_PATH" "INSERT INTO steps (task_id, step_name, status, attempts, error, started_at) VALUES ('$(_sq "$task_id")', '$(_sq "$step_name")', '$(_sq "$status")', 1, '$(_sq "$error")', datetime('now'));"
    else
        sqlite3 "$DB_PATH" "UPDATE steps SET status = '$(_sq "$status")', attempts = attempts + 1, error = '$(_sq "$error")', completed_at = CASE WHEN '$(_sq "$status")' IN ('completed', 'failed', 'skipped') THEN datetime('now') ELSE completed_at END WHERE task_id = '$(_sq "$task_id")' AND step_name = '$(_sq "$step_name")';"
    fi
}

# 更新下载状态
update_download() {
    local task_id="$1"
    local status="$2"
    local error="${3:-}"
    local file_path="${4:-}"

    local exists=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM downloads WHERE task_id='$(_sq "$task_id")';" )

    if [ "$exists" -eq "0" ]; then
        sqlite3 "$DB_PATH" "INSERT INTO downloads (task_id, status, attempts, error) VALUES ('$(_sq "$task_id")', '$(_sq "$status")', 1, '$(_sq "$error")');"
    else
        sqlite3 "$DB_PATH" "UPDATE downloads SET status = '$(_sq "$status")', attempts = attempts + 1, error = '$(_sq "$error")', file_path = '$(_sq "$file_path")' WHERE task_id = '$(_sq "$task_id")';"
    fi
}

# 获取任务
get_task() {
    local id="$1"
    sqlite3 -json "$DB_PATH" "SELECT * FROM tasks WHERE id = '$(_sq "$id")';"
}

# 获取步骤
get_steps() {
    local task_id="$1"
    sqlite3 -json "$DB_PATH" "SELECT * FROM steps WHERE task_id = '$(_sq "$task_id")';"
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
