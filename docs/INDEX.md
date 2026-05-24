# docs/ 文档索引

> 初次阅读？先看 [GUIDE.md](GUIDE.md) — 解释目录结构、命名规范和如何新增文档。

## reference/ — 查阅类

| 文件 | 用途 |
|------|------|
| [reference/architecture.md](reference/architecture.md) | 系统架构、目录结构、调用链、Pipeline 阶段、设计决策、维护注意事项 |
| [reference/api.md](reference/api.md) | HTTP API 路由、reset_scope 语义、任务参数、测试约定 |
| [reference/design-system.md](reference/design-system.md) | 前端设计系统（Swiss Minimal 风格、CSS Token、组件约定） |
| [reference/cli.md](reference/cli.md) | `vdl` CLI 完整参考：子命令、选项、服务生命周期、Token 管理、进度格式、退出码 |

## how-to/ — 操作指南

| 文件 | 用途 |
|------|------|
| [how-to/deploy.md](how-to/deploy.md) | 新机器/新环境部署：依赖、配置、安装步骤、启动方式 |
| [how-to/agent-run-task.md](how-to/agent-run-task.md) | Agent/脚本通过 HTTP API 执行 YouTube 任务：创建→轮询→取结果→处理异常 |
| [how-to/cli.md](how-to/cli.md) | `vdl` CLI 使用方式：安装、子命令、与 GUI/HTTP Service 并发使用 |
| [how-to/debug-env.md](how-to/debug-env.md) | 调试日志聚合环境的设置与使用（日志过滤、来源标签、守护进程管理） |
| [how-to/electron-dev-icon.md](how-to/electron-dev-icon.md) | 开发模式下为 Electron 设置自定义 macOS Dock 图标（生成 .icns、替换 bundle、清图标缓存） |

开发调试环境（Dev Harness）：见 [`harness/README.md`](../harness/README.md)（就近原则，与代码同目录）。

## explanation/ — 理解类

| 文件 | 用途 |
|------|------|
| [explanation/git-workflow.md](explanation/git-workflow.md) | GitFlow 分支策略与合并规范（为什么 no-ff，为什么 staging 作为中间层） |
| [explanation/asr-and-dag.md](explanation/asr-and-dag.md) | ASR 回退机制与 DAG 可达性调度原理（两条路径到 vtt2md、OR 门语义、任务失败判定） |
| [explanation/singleton-backend.md](explanation/singleton-backend.md) | 统一后端与心跳机制原理（固定端口 3000、心跳引用计数、auto-shutdown、EADDRINUSE 竞争处理、崩溃恢复） |
| [explanation/electron-macos-icon-cache.md](explanation/electron-macos-icon-cache.md) | macOS Dock 图标在 Electron 开发模式下不生效的原因（bundle 优先级、Icon Services 缓存机制、app.dock.setIcon 局限） |

## adr/ — Architecture Decision Records

记录重大架构决策，格式：背景 → 决策 → 理由 → 影响。

| 文件 | 内容 |
|------|------|
| [adr/2026-03-15-electron-modal-stacking.md](adr/2026-03-15-electron-modal-stacking.md) | Electron 全局弹窗层叠稳定性方案（appendChild + no inline onclick） |
| [adr/2026-04-13-mode-redesign.md](adr/2026-04-13-mode-redesign.md) | Task mode 系统重设计（media/audio/transcript/full 替代旧 both/video/audio/transcript） |
| [adr/2026-04-17-asr-fallback.md](adr/2026-04-17-asr-fallback.md) | ASR 回退集成（OR 门、动态排除条件、媒体源优先级、subs 语义不变） |
| [adr/2026-04-18-dag-reachability.md](adr/2026-04-18-dag-reachability.md) | DAG 可达性算法（替代硬编码失败检测、GATE_TYPE/TERMINAL_NODE、md2vtt 静默 bug 修复） |
| [adr/2026-05-19-task-abort.md](adr/2026-05-19-task-abort.md) | 任务中止机制（进程组 kill、运行时 abort flag、任务级/步骤级粒度、同步响应） |
| [adr/2026-05-19-task-resume.md](adr/2026-05-19-task-resume.md) | 任务 Resume 机制（独立 aborted 状态、DB status 列迁移、复用 runTask() 继续执行、手动恢复语义） |
| [adr/2026-05-23-singleton-backend.md](adr/2026-05-23-singleton-backend.md) | 单例后端决策（固定端口、心跳引用计数替代进程所有权、token 文件在 bind 后写入） |

## rfcs/ — 提案（未实现）

| 文件 | 内容 |
|------|------|
| [rfcs/2026-03-17-writing-engine-model-config.md](rfcs/2026-03-17-writing-engine-model-config.md) | OpenCode 模型可配置化设计（`WRITING_OPENCODE_MODEL_DEFAULT` 等，暂未实现） |

## archive/ — 历史归档

`archive/` — 所有已完成的历史设计与实现计划（2026-03-05 ~ 2026-05-19），仅供回溯参考，不再更新。新增归档（2026-05-19）：

| 文件 | 内容 |
|------|------|
| [archive/2026-05-19-task-resume-design.md](archive/2026-05-19-task-resume-design.md) | Task Resume 功能设计规格（brainstorming 产出） |
| [archive/2026-05-19-task-resume-plan.md](archive/2026-05-19-task-resume-plan.md) | Task Resume 功能实施计划（subagent-driven-development 执行模板） |
