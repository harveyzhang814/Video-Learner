---
title: 支持配置 work 根目录路径以便 Syncthing 同步
date: 2026-06-23
status: approved
topic: configurable-work-root
---

# 支持配置 work 根目录路径以便 Syncthing 同步

## 背景与目标

当前 `work/` 目录的路径硬编码为 `<projectRoot>/work`，无法移出项目目录，
不便于通过 Syncthing 等工具在多设备间同步任务产物。

硬编码分布在 **两个运行时**，今天没有任何共享配置层：

**Node 侧**（直接 `path.join(rootDir, 'work', …)`）：
- `core/orchestrator/db.js:8` — `getDbPath`
- `core/orchestrator/index.js` — `getWorkDir`、`appendIndex`（index.jsonl）、reset/cleanup 等多处
- `core/orchestrator/stepArtifacts.js:37`
- `cli/commands/run.js:111`
- `cli/commands/list.js:5`

**Shell 侧**（各脚本独立计算 `DB_PATH="$PROJECT_DIR/work/database.sqlite"`）：
- `scripts/fetch_info.sh`、`scripts/download_subs.sh`、`scripts/download_video.sh`、
  `scripts/generate_article.sh`、`scripts/generate_summary.sh`
- `scripts/db.sh`（相对路径 `work/database.sqlite` + 基于脚本位置补 `PROJECT_DIR`）

此外 `scripts/settings.conf`（bash `KEY=value`，已 gitignore）目前**只被 shell 读，
Node 完全不读它**。

**目标**：引入一个可配置的 **根目录（root）** `WORK_ROOT`，让真正的工作目录
变为 `<WORK_ROOT>/work`，使用户可将其指向 Syncthing 管理的共享目录。默认值为
项目根，**行为完全向后兼容**。

## 关键语义：配置的是 root，不是 work 目录本身

配置项 `WORK_ROOT` 指向一个**根目录**；真正的产物存放在它下面的 `work/` 子目录：

```
WORK_ROOT = ~/Syncthing/video-learner
        ↓
workDir  = ~/Syncthing/video-learner/work/<id>/...
dbPath   = ~/Syncthing/video-learner/work/database.sqlite
indexPath= ~/Syncthing/video-learner/work/index.jsonl
```

等价于把今天硬编码路径里的 `projectRoot` 替换为可配置的 `WORK_ROOT`：

```
旧: <projectRoot>/work/<id>/...
新: <WORK_ROOT>/work/<id>/...        (WORK_ROOT 默认 = projectRoot)
```

由此带来两个必须显式处理的点：

1. **`/work/` 这一段路径始终存在**。不管 root 在哪，下面都有 `work/` 子目录。
   因此 `generate_article.sh`/`generate_summary.sh` 中
   `s|.*/work/([^/]+)/...|\1|` 的任务 ID 抽取**不会因本功能而失效**。但仍按本设计
   做健壮性加固（见 §4），去掉对贪婪回溯的隐式依赖。
2. **work 子目录可能尚未存在**。当 `WORK_ROOT` 指向一个外部空目录时，里面还没有
   `work/`。打开 SQLite **之前**必须先 `mkdir -p <WORK_ROOT>/work`（Node 与 shell
   两侧都要保证），否则首次在新 root 上启动会因 DB 父目录不存在而失败。

## 设计

### 1. 配置与解析契约（两端必须一致）

配置键：在 `scripts/settings.conf` 新增 `WORK_ROOT=`（`settings.example.conf` 同步
加上带注释的示例）。

**解析规则（Node 与 shell 实现必须等价）：**

1. 若环境变量 `WORK_ROOT` 已设置且非空，使用它；
2. 否则若 `settings.conf` 定义了非空 `WORK_ROOT`，使用它；
3. 否则默认 `projectRoot`（即今天的 `<projectRoot>/work`，向后兼容）。

**路径规范化：**

- 展开前导 `~` 与 `$VAR` / `${VAR}`；
- 解析结果必须是**绝对路径**；去掉末尾斜杠；
- 空字符串视为「未设置」，回退到下一优先级。

最终：`workDir = <resolvedRoot>/work`。

### 2. Node 侧——单一解析器，统一使用

新增模块 `core/work-dir.js`，导出：

- `resolveWorkRoot(rootDir)` — 读取 `settings.conf` + 环境变量，按 §1 规则返回
  **绝对 root 路径**；
- `getWorkDir(rootDir, id)` → `<root>/work/<id>`
- `getDbPath(rootDir)` → `<root>/work/database.sqlite`
- `getIndexPath(rootDir)` → `<root>/work/index.jsonl`

替换以下硬编码处改为调用该模块：`core/orchestrator/db.js`、
`core/orchestrator/index.js`（`getWorkDir`、`appendIndex` 及 reset/cleanup 各处）、
`core/orchestrator/stepArtifacts.js`、`cli/commands/run.js`、`cli/commands/list.js`。

**mkdir 保证**：在打开 SQLite 之前（`db.js` 的 `ensureDb`/首次连接路径）
`fs.mkdirSync(<root>/work, { recursive: true })`，确保 DB 父目录存在。

**注入子进程**：`core/orchestrator/index.js` 的 `spawnEnv()` 额外把解析好的
`WORK_ROOT`（绝对路径）注入子进程环境，使脚本与 Node 算出**完全相同**的路径，
避免两端漂移。

`settings.conf` 解析器为轻量实现：逐行读取 `KEY=value`，忽略注释/空行，取
`WORK_ROOT` 一项即可（不求实现完整 bash 语义）。

### 3. Shell 侧——单一 sourced 助手

新增 `scripts/work_dir.sh`（被各脚本 `source`）：

1. 定位 `PROJECT_DIR`；
2. 若环境变量 `WORK_ROOT` 未设置，则 `source settings.conf` 取其 `WORK_ROOT`；
3. 按 §1 规则解析（展开 `~`，默认 `PROJECT_DIR`），导出：
   - `WORK_ROOT`（绝对）
   - `WORK_DIR="$WORK_ROOT/work"`
   - `DB_PATH="$WORK_DIR/database.sqlite"`
4. `mkdir -p "$WORK_DIR"`。

将各脚本中 `DB_PATH="$PROJECT_DIR/work/database.sqlite"`（`fetch_info.sh`、
`download_subs.sh`、`download_video.sh`、`generate_article.sh`、
`generate_summary.sh`）与 `db.sh` 的相对路径补全逻辑，统一替换为
`source work_dir.sh`。

> 注：大多数脚本的**每任务工作目录**是 Node 通过 `DIR` 参数传入的已解析绝对路径，
> 本身已正确；shell 侧的独立计算仅限 `DB_PATH`，故改动收敛在 DB 路径解析与下方
> 正则加固。

### 4. 任务 ID 正则加固（健壮性）

`generate_article.sh`、`generate_summary.sh` 当前用
`s|.*/work/([^/]+)/transcript.*|\1|`、`s|.*/work/([^/]+)/writing.*|\1|`
从路径抽取 TASK_ID，写死了 `/work/` 字面段并依赖贪婪回溯。

改为匹配 `/transcript/`、`/writing/` **前一段**目录名，与上层目录命名无关：

```
s|.*/([^/]+)/transcript/.*|\1|
s|.*/([^/]+)/writing/.*|\1|
```

### 5. 迁移与文档（用户手动迁移）

- **不做自动迁移**。新增 how-to 文档（`docs/how-to/`）：说明如何设置 `WORK_ROOT`、
  将现有 `work/` 内容 `mv` 到 `<新 root>/work`（或从空目录全新开始）、再把 Syncthing
  指向该 root。
- **Syncthing / SQLite 警告（仅文档，不加代码防护）**：不要在两台设备上同时运行后端
  ——`database.sqlite` 及其 WAL 文件并发同步可能损坏数据库。单设备轮流使用是安全的。

### 6. 测试

- `tests/` 下新增 `core/work-dir.js` 单元测试：环境变量覆盖、`settings.conf` 取值、
  默认回退、`~` / `$VAR` 展开、末尾斜杠与空值处理。
- **对拍测试**：对同一份 `settings.conf`，断言 `scripts/work_dir.sh` 与
  `core/work-dir.js` 解析出**相同的绝对 root / workDir / dbPath**，防止两端实现漂移。
- 回归：运行现有 `npm run test:agent:core`、`npm run test:orchestrator:unit`，确认
  未设置 `WORK_ROOT` 时默认行为不变。

## 非目标（YAGNI）

- 不做自动迁移 / 旧数据搬运。
- 不为 SQLite 跨设备并发同步加锁或加任何代码防护（仅文档提醒）。
- 不支持相对路径语义（`WORK_ROOT` 仅接受绝对路径，含 `~`/`$VAR` 展开）。
- 不改变 work 子目录的内部结构（仍为 `<root>/work/<id>/{media,transcript,writing,logs}`）。
