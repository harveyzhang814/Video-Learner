# 部署指南

本文说明将本仓库部署到**新机器**或**新环境**时的依赖、配置文件与环境变量。编排入口为 **GUI（Electron）** 或 **Agent Service（HTTP）**，二者共用 `core/orchestrator` 与 `work/` 数据目录。

---

## 1. 前置条件

| 类别 | 要求 |
|------|------|
| 操作系统 | `scripts/install.sh` 支持 **macOS**（Homebrew）与 **Linux**（apt 系）；其他发行版需自行安装等价依赖。 |
| 运行时 | **Node.js** + **npm**（根目录与 `electron/` 均需 `npm install`）。 |
| 媒体与字幕 | **yt-dlp**、**ffmpeg**、**jq**（安装脚本或包管理器）。 |
| 写作引擎（二选一） | **`opencode` CLI**（推荐与默认）和/或 **`claude` CLI**；仅当 `WRITING_ENGINE_DEFAULT=claude`（或环境变量强制）时才需要本机安装 `claude`。 |
| 网络 | 访问 YouTube、以及所选写作引擎所需 API（如 OpenCode 所用模型提供方）。 |

---

## 2. 本地配置文件 `~/.config/vdl/settings.conf`

首次运行 `vdl` 命令时，向导自动从内置模板创建 `~/.config/vdl/settings.conf`，无需手动复制。

若需提前手动创建：

```bash
mkdir -p ~/.config/vdl
cp /opt/homebrew/lib/node_modules/video-learner/scripts/settings.example.conf ~/.config/vdl/settings.conf
```

按环境编辑，常用项：

| 变量 | 说明 |
|------|------|
| `WRITING_ENGINE_DEFAULT` | `opencode` 或 `claude`。仅安装 OpenCode 时务必设为 **`opencode`**。非法或未设时，`llm_engine.sh` 会回退为 `opencode`。 |
| `OUTPUT_LANG` | 文章/总结输出语言，如 `zh-CN`。 |
| `YT_DLP_COOKIES_BROWSER` | 出现 *Sign in to confirm you're not a bot* 时，从已登录浏览器取 Cookie（如 `chrome`、`safari`）。与 `YT_DLP_COOKIES_FILE` 二选一即可。 |
| `YT_DLP_COOKIES_FILE` | Netscape 格式 cookie 文件路径。 |

其他键（`DOWNLOAD_VIDEO`、`DEFAULT_QUALITY`、`TRANSCRIPT_LANG` 等）见 `settings.example.conf` 内注释。

`scripts/yt-dlp-cookies.sh` 会在调用 yt-dlp 的脚本中自动读取 `~/.config/vdl/settings.conf` 中的 Cookie 配置。

---

## 3. 环境变量（可选）

| 变量 | 使用场景 | 默认 / 说明 |
|------|----------|-------------|
| `PORT` | 手动执行 `npm run agent:serve` | 默认 **3000**。 |
| `AGENT_EVENTS_TOKEN` | 独立启动 HTTP 服务且需**固定** SSE `token` | 未设置时进程内随机生成；Electron 子进程启动服务时会自动注入随机 token。 |
| `WRITING_ENGINE` | 覆盖 `settings.conf` 中的默认引擎 | `claude` \| `opencode`，优先级高于 `WRITING_ENGINE_DEFAULT`。 |
| `OPENCODE_HOST` | OpenCode HTTP 服务地址 | 默认 `127.0.0.1`。 |
| `OPENCODE_PORT` | OpenCode HTTP 服务端口 | 默认 **4097**；`scripts/opencode_server.sh` 与 `llm_engine.sh` 使用。 |

在启动 **Electron** 或 **`npm run agent:serve`** 之前导出环境变量，子进程中的 shell 步骤会继承。

---

## 4. 安装步骤（建议顺序）

1. **克隆仓库**并进入根目录。
2. **配置文件**：首次运行 `vdl` 命令时向导自动创建 `~/.config/vdl/settings.conf`，无需手动操作。
3. **系统依赖**：`bash scripts/install.sh`（按脚本支持平台安装 yt-dlp、ffmpeg、jq 等）。
4. **根目录 Node 依赖**：在仓库根目录执行 `npm install`（Agent Service、测试脚本等需要）。
5. **Electron 依赖**：`cd electron && npm install`（仅使用 GUI 时需要）。
6. **写作引擎**：安装并登录 **OpenCode** 和/或 **Claude CLI**，与 `WRITING_ENGINE_DEFAULT` 一致。
7. **验证 OpenCode（可选）**：`bash scripts/test_opencode_smoke.sh`（需已配置为 opencode 路径）。

---

## 5. 启动方式与数据目录

| 方式 | 命令 | 说明 |
|------|------|------|
| GUI | `bash start-electron.sh` | 内嵌启动本地 HTTP 服务（随机端口 + token），通过 SSE 刷新界面。 |
| Agent Service | `npm run agent:serve` | 默认 `http://localhost:$PORT`；自行保存启动日志中的 SSE token 或设置 `AGENT_EVENTS_TOKEN`。 |

运行时数据位于 **`~/vdl-work/work/`**（默认；可在 `~/.config/vdl/settings.conf` 通过 `WORK_ROOT` 修改）：

- `work/database.sqlite`：任务与步骤状态（GUI 与 HTTP 共用）。
- `work/<id>/`：各 URL 对应的媒体、转录、文章与总结产物。

`work/` 通常不纳入版本控制；新部署若无迁移需求可从空目录开始。

---

## 6. 仅 OpenCode、不安装 Claude

将 `~/.config/vdl/settings.conf` 中 **`WRITING_ENGINE_DEFAULT=opencode`**，且不要将 **`WRITING_ENGINE=claude`** 写进全局环境。流水线中的 `generate_article.sh` / `generate_summary.sh` 经 `llm_engine.sh` 只会在选中 `claude` 时调用 `claude` 可执行文件。

---

## 7. 安全与边界说明

- HTTP 服务默认面向 **本机**；若将 `PORT` 暴露到局域网或公网，需自行评估鉴权与防火墙。
- **SSE** 使用 query `token`；生产化部署时应使用强随机 `AGENT_EVENTS_TOKEN` 并避免写入公开文档。
- OpenCode `opencode serve` 由项目脚本以 **`OPENCODE_SERVER_PASSWORD=""`** 在本地拉起时常见于开发场景；若调整监听地址，勿在未防护网络下暴露无鉴权服务。

---

## 相关文档

- [README.md](../../README.md)：快速开始与功能概览。
- [reference/architecture.md](../reference/architecture.md)：架构、Agent API、依赖细节。
- [settings.example.conf](../../scripts/settings.example.conf)：配置项模板与注释。
