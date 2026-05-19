# docs/ 文档索引

> 初次阅读？先看 [GUIDE.md](GUIDE.md) — 解释目录结构、命名规范和如何新增文档。

## reference/ — 查阅类

| 文件 | 用途 |
|------|------|
| [reference/architecture.md](reference/architecture.md) | 系统架构、目录结构、调用链、Pipeline 阶段、设计决策、维护注意事项 |
| [reference/api.md](reference/api.md) | HTTP API 路由、reset_scope 语义、任务参数、测试约定 |
| [reference/design-system.md](reference/design-system.md) | 前端设计系统（Swiss Minimal 风格、CSS Token、组件约定） |

## how-to/ — 操作指南

| 文件 | 用途 |
|------|------|
| [how-to/deploy.md](how-to/deploy.md) | 新机器/新环境部署：依赖、配置、安装步骤、启动方式 |
| [how-to/agent-run-task.md](how-to/agent-run-task.md) | Agent/脚本通过 HTTP API 执行 YouTube 任务：创建→轮询→取结果→处理异常 |
| [how-to/cli.md](how-to/cli.md) | `vdl` CLI 使用方式：安装、子命令、与 GUI/HTTP Service 并发使用 |
| [how-to/debug-env.md](how-to/debug-env.md) | 调试日志聚合环境的设置与使用（日志过滤、来源标签、守护进程管理） |

开发调试环境（Dev Harness）：见 [`harness/README.md`](../harness/README.md)（就近原则，与代码同目录）。

## explanation/ — 理解类

| 文件 | 用途 |
|------|------|
| [explanation/git-workflow.md](explanation/git-workflow.md) | GitFlow 分支策略与合并规范（为什么 no-ff，为什么 staging 作为中间层） |

## adr/ — Architecture Decision Records

记录重大架构决策，格式：背景 → 决策 → 理由 → 影响。

| 文件 | 内容 |
|------|------|
| [adr/2026-04-13-mode-redesign.md](adr/2026-04-13-mode-redesign.md) | Task mode 系统重设计（media/audio/transcript/full 替代旧 both/video/audio/transcript） |
| [adr/2026-03-15-electron-modal-stacking.md](adr/2026-03-15-electron-modal-stacking.md) | Electron 全局弹窗层叠稳定性方案（appendChild + no inline onclick） |
| [adr/2026-05-19-task-abort.md](adr/2026-05-19-task-abort.md) | 任务中止机制（进程组 kill、运行时 abort flag、任务级/步骤级粒度、同步响应） |

## rfcs/ — 提案（未实现）

| 文件 | 内容 |
|------|------|
| [rfcs/2026-03-17-writing-engine-model-config.md](rfcs/2026-03-17-writing-engine-model-config.md) | OpenCode 模型可配置化设计（`WRITING_OPENCODE_MODEL_DEFAULT` 等，暂未实现） |

## archive/ — 历史归档

`archive/` — 所有已完成的历史设计与实现计划（2026-03-05 ~ 2026-04-13），仅供回溯参考，不再更新。
