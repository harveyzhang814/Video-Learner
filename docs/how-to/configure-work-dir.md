# 配置 work 目录路径（Syncthing 同步）

默认情况下，所有任务产物与 SQLite 数据库存放在项目目录下的 `work/`。
通过 `WORK_ROOT` 配置项，可把它移到项目外的任意目录——例如 Syncthing
管理的共享目录，实现多设备间任务产物的自动同步。

## 配置方式

`WORK_ROOT` 指向一个**根目录**，真正的产物存放在它下面的 `work/` 子目录：

    WORK_ROOT = ~/Syncthing/video-learner
            ↓
    实际工作目录 = ~/Syncthing/video-learner/work/

解析优先级（Node 与 shell 一致）：

1. 环境变量 `WORK_ROOT`（单次会话覆盖）
2. `scripts/settings.conf` 中的 `WORK_ROOT`（持久配置）
3. 未设置时：项目目录（即默认 `<项目>/work`）

`WORK_ROOT` 必须是**绝对路径**，支持前导 `~` 与 `$VAR` 展开。

### 持久配置（三种等效方式，选其一）

**方式一：CLI**

    vdl config set work-root ~/Syncthing/video-learner

**方式二：HTTP API**

    curl -X POST http://127.0.0.1:3000/api/config \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer <token>" \
      -d '{"workRoot":"~/Syncthing/video-learner"}'
    # → { "ok": true, "restart_required": true }

**方式三：直接编辑** `scripts/settings.conf`：

    WORK_ROOT=~/Syncthing/video-learner

CLI 和 API 均写入 `scripts/settings.conf`，效果相同。修改后重启后端生效。

### 单次覆盖（不写 settings.conf）

    vdl --work-root ~/Syncthing/video-learner <URL>
    # 或
    WORK_ROOT=/mnt/external vdl <URL>

## 迁移已有数据

改路径不会自动搬运既有产物。手动迁移：

    # 1. 设置 WORK_ROOT（见上）
    # 2. 把现有 work/ 内容移到新位置（注意保留 work 子目录这一层）
    mkdir -p ~/Syncthing/video-learner
    mv /path/to/project/work ~/Syncthing/video-learner/work
    # 3. 让 Syncthing 同步 ~/Syncthing/video-learner

或不迁移、从空目录全新开始亦可。

## ⚠️ Syncthing + SQLite 重要警告

`<WORK_ROOT>/work/database.sqlite` 是单一权威状态库，并使用 WAL 模式
（额外的 `-wal`/`-shm` 文件）。

**不要在两台设备上同时运行后端。** 若多设备同时写入并由 Syncthing
并发同步数据库及其 WAL 文件，可能导致数据库损坏或同步冲突。

安全用法：**单设备轮流使用**——一台设备使用时，确保另一台未运行后端
（CLI / `vdl web` / `npm run agent:serve` / Electron 均会启动后端）。
切换设备前，等待 Syncthing 完成同步。
