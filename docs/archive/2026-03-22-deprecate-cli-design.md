# 废弃 CLI 一键入口（`scripts/run.sh`）设计

> 状态：已确认（方案 2 + 薄壳 A + 测试默认走 HTTP 编排）

## 背景与目标

- 项目正式入口为 **GUI（Electron）** 与 **Agent Service（HTTP → `core/orchestrator` → 分步 `scripts/*.sh`）**。
- **`scripts/run.sh`** 为历史「一键 CLI」，与编排层并行，易造成双路径维护。
- **目标**：在仓库内废弃该入口：调用即 **明确失败 + 替代指引**，并把仍依赖 `run.sh` 的自动化迁到 **与 `npm run test:agent:e2e` 一致的 HTTP 路径**。

## 决策摘要

| 项 | 选择 |
|----|------|
| 废弃形态 | **A：薄壳弃用** — 保留文件路径，内容改为说明 + `exit 1`，不再执行流水线 |
| 测试迁移偏好 | 无偏好 → **默认与现有 e2e 对齐**：`scripts/test_full_e2e.sh` 改为转发 `npm run test:agent:e2e`（默认 `E2E_PIPELINE_MODE=transcript`） |

## 架构影响

- **运行时**：GUI / Agent Service **不依赖** `run.sh`；仅依赖 `core/orchestrator` 与各 `scripts/<step>.sh`。废弃后 **无新增运行时耦合**。
- **弃用后**：唯一流水线编排语义以 **orchestrator + 分步脚本** 为准；不再要求 `run.sh` 与 `download_subs.sh` 等「两处同改」。

## `scripts/run.sh`（薄壳）行为约定

- 向 stderr（或 stdout）输出简短说明：
  - 启动 GUI：`bash start-electron.sh`（或 `npm start`）。
  - Agent Service：`npm run agent:serve`（或项目文档中的标准端口/鉴权说明）。
  - 自动化：`npm run test:agent:e2e` 等。
- **以非零状态退出**（例如 `exit 1`）。
- **不**再调用 `download_video`、`get_transcript`、写作引擎等逻辑。

## 文档与脚本改动范围

- **用户可见**：`README.md`、`scripts/install.sh` 安装完成提示。
- **贡献者可见**：`CLAUDE.md`、`docs/PROJECT_KNOWLEDGE.md`（架构图与「CLI 一键」章节改为已废弃 + 替代方式）。
- **测试**：`scripts/test_full_e2e.sh` 不再调用 `run.sh`。
- **历史 `docs/plans/*`**：一般不追溯修改；在 `PROJECT_KNOWLEDGE` 中可注明历史文档可能仍出现 `run.sh`。

## 测试迁移说明（重要）

- 旧 `test_full_e2e.sh` 注释曾写「跳过 article/summary」，但 **`MODE=get_transcript` 在 `run.sh` 中仍受 `mode_has_transcript` 约束，会跑 article/summary**（与 orchestrator 的 `transcript` 模式一致：跳过视频/音频下载，仍跑写作步骤）。
- 转发到 `test:agent:e2e` 后，**仍需本机写作引擎**（`WRITING_ENGINE` / `settings.conf` 与 `opencode_server.sh ensure` 等），与当前 `tests/agent-service-e2e.test.js` 前置条件一致。

## 实施前核对（防逻辑丢失）

- 在将 `run.sh` 改为薄壳前，快速 diff：**是否存在仅 `run.sh` 拥有、分步脚本未覆盖的行为**（历史上字幕策略等曾双写）。若有，必须先合并到对应 `scripts/*.sh` / orchestrator。

## 验收标准

1. 执行 `bash scripts/run.sh "https://..."` → **打印弃用说明**，**exit ≠ 0**，且无流水线副作用。
2. `scripts/test_full_e2e.sh`（或其后继）**不依赖** `run.sh` 成功完成校验。
3. `npm run test:agent:e2e` 行为不变（仍为 HTTP 编排金标准）。
4. 主要文档与安装脚本不再将 `run.sh` 描述为支持的使用方式。

## 后续

- 实施清单见：`docs/plans/2026-03-22-deprecate-cli-implementation.md`（`writing-plans` 产出）。
- 执行时可选用 **subagent-driven** 或 **独立会话 + executing-plans**（见该文件头部说明）。
