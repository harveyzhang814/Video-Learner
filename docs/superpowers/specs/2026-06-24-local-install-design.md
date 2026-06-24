# vdl 本地独立安装设计

**日期**：2026-06-24  
**状态**：已批准

## 背景

当前 `vdl` 通过 `npm link` 安装，实质是 symlink 指向仓库目录。删除仓库后 `vdl` 立即失效。目标：切换为真实拷贝安装（`npm install -g .`），用户数据迁移至家目录，使 `vdl` 能独立于仓库长期运行。

## 目标

- 删除仓库目录后，`vdl` 在本机持续正常工作
- 用户配置（`settings.conf`）在版本升级时不被覆盖
- 支持从其他机器迁移 `work/` 目录后直接使用

## 不在范围内

- 跨机器打包/发布（npm publish、tarball 分发）
- Windows 支持

---

## 架构概览

```
安装位置（只读，随版本升级覆盖）
/opt/homebrew/lib/node_modules/video-learner/
  cli/
  core/
    user-config.js          ← 新增：JS 侧用户配置路径常量
  scripts/
    user-config.sh          ← 新增：Shell 侧用户配置权威（source-only）
    work_dir.sh             ← 改：source user-config.sh
    llm_engine.sh           ← 改：source user-config.sh
    yt-dlp-cookies.sh       ← 改：source user-config.sh
    settings.example.conf   ← 保留：首次运行时复制用

用户数据（持久化，升级不覆盖）
~/.config/vdl/
  settings.conf             ← 用户本机配置（从 example 自动创建）

~/vdl-work/                 ← 任务数据（默认，可在 settings.conf 改）
  work/
    database.sqlite
    <task-id>/
```

---

## 新增文件

### `scripts/user-config.sh`

source-only 脚本，集中处理用户配置路径，其他 shell 脚本 source 后直接使用已加载的变量：

```bash
# 解析顺序：env 覆盖 > 默认路径
VDL_USER_CONFIG="${VDL_CONFIG_FILE:-$HOME/.config/vdl/settings.conf}"

if [ -f "$VDL_USER_CONFIG" ]; then
    # shellcheck source=/dev/null
    source "$VDL_USER_CONFIG"
fi
```

单一职责：找到配置文件并 source，不做业务逻辑。

### `core/user-config.js`

JS 侧用户配置路径常量：

```js
'use strict';
const os = require('os');
const path = require('path');

const USER_CONFIG_DIR  = path.join(os.homedir(), '.config', 'vdl');
const USER_CONFIG_PATH = path.join(USER_CONFIG_DIR, 'settings.conf');
const DEFAULT_WORK_ROOT = path.join(os.homedir(), 'vdl-work');

module.exports = { USER_CONFIG_DIR, USER_CONFIG_PATH, DEFAULT_WORK_ROOT };
```

---

## 现有文件改动

### `core/paths.js` — `resolveWorkBase()` 查找链

**改前**：`env WORK_ROOT` → `<rootDir>/scripts/settings.conf` → `rootDir`（安装目录）

**改后**：`env WORK_ROOT` → `~/.config/vdl/settings.conf` → `~/vdl-work`

引入 `core/user-config.js` 的 `USER_CONFIG_PATH` 和 `DEFAULT_WORK_ROOT`，删除对 `path.join(base, 'scripts', 'settings.conf')` 的读取。

### `scripts/work_dir.sh`

删除原有 `settings.conf` 查找块，改为 source `user-config.sh`：

```bash
_wd_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_wd_script_dir/user-config.sh"
# 原 if [ -z "${WORK_ROOT:-}" ] && [ -f "$_wd_script_dir/settings.conf" ] 块删除
```

### `scripts/llm_engine.sh` 和 `scripts/yt-dlp-cookies.sh`

同理：删除各自的 `source $SCRIPT_DIR/settings.conf` 逻辑，改为：

```bash
source "$SCRIPT_DIR/user-config.sh"
```

### `cli/index.js`

在所有子命令执行前调用 `ensureUserConfig()`（见下节）。

---

## 首次运行向导

### 触发条件

`~/.config/vdl/settings.conf` 不存在。

### 流程

```
$ vdl https://...

Welcome to vdl! Setting up your config...
Work root [~/vdl-work]: /Volumes/Data/vdl-data
  (tasks will be stored under <work root>/work/)

Checking /Volumes/Data/vdl-data/work/ ...
✓ Found existing data (database.sqlite + 3 task folders) — will be loaded automatically.

✓ Config created: ~/.config/vdl/settings.conf
✓ Data directory:  /Volumes/Data/vdl-data/work/

(继续执行原命令)
```

### `ensureUserConfig()` 逻辑

1. 检查 `~/.config/vdl/settings.conf` 是否存在 → 存在则立即返回
2. 读取安装目录中的 `scripts/settings.example.conf`（通过 `__dirname` 定位）
3. 交互式询问 `WORK_ROOT`（readline），默认值 `~/vdl-work`
4. 检测目标路径下的现有数据（见下节）
5. 将用户输入写入配置文件（复用 `core/paths.js` 的 `writeWorkRoot()`）
6. 从 example 复制其余配置项到 `~/.config/vdl/settings.conf`

### 现有数据检测

用户输入 `WORK_ROOT` 后，在写入前检测：

| 条件 | 提示 |
|------|------|
| `<WORK_ROOT>/work/database.sqlite` 存在 | `✓ Found existing data (database.sqlite ...) — will be loaded automatically.` |
| `<WORK_ROOT>/work/` 存在且非空（无 DB） | `✓ Found existing task folders — will be loaded automatically.` |
| 目录不存在或为空 | `✓ New work directory will be created at <path>/work/` |

无迁移代码——`WORK_ROOT` 指向哪里，orchestrator 直接读取。

### 非交互环境

检测 `!process.stdin.isTTY`，跳过提问，使用默认值 `~/vdl-work`，静默创建配置。

---

## 安装方式变更

```bash
# 旧（symlink，删仓库即失效）
npm link

# 新（真实拷贝，删仓库没问题）
npm install -g .
```

更新 `docs/how-to/cli.md` 和 `docs/how-to/deploy.md`。

## 向后兼容

安装目录中的 `scripts/settings.conf`（如已存在）不删除，但 `user-config.sh` 不主动 source 它。升级后配置从 `~/.config/vdl/settings.conf` 读取，旧文件静默忽略。

---

## 测试策略

### `core/user-config.js`（单元）
- 路径常量包含正确的 `os.homedir()` 前缀

### `core/paths.js` — `resolveWorkBase()`（扩展现有测试）
- `WORK_ROOT` env 优先于 `~/.config/vdl/settings.conf`
- `~/.config/vdl/settings.conf` 存在时正确读取
- 两者都不存在时 fallback 到 `~/vdl-work`
- 旧路径 `scripts/settings.conf` 不再被读取

### `ensureUserConfig()`（新增集成测试）
- 配置已存在 → 直接返回，不覆盖
- 配置不存在 → 创建文件，内容与 example 一致
- `<WORK_ROOT>/work/database.sqlite` 存在 → 输出"Found existing data"
- 非交互环境（`!process.stdin.isTTY`）→ 使用默认值，不挂起

### `scripts/work_dir.sh`（扩展现有测试）
- 通过 `VDL_CONFIG_FILE` 注入测试配置，验证改后路径读取正确

---

## 改动文件一览

| 类型 | 文件 |
|------|------|
| 新增 | `scripts/user-config.sh` |
| 新增 | `core/user-config.js` |
| 修改 | `scripts/work_dir.sh` |
| 修改 | `scripts/llm_engine.sh` |
| 修改 | `scripts/yt-dlp-cookies.sh` |
| 修改 | `core/paths.js` |
| 修改 | `cli/index.js` |
| 文档 | `docs/how-to/cli.md` |
| 文档 | `docs/how-to/deploy.md` |
