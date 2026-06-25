# 文档目录指南

本文说明 `docs/` 目录的结构设计、每个目录的用途、命名规范，以及如何新增文档。

---

## 设计原则：Diátaxis

本项目的文档结构基于 **[Diátaxis](https://diataxis.fr/)** 方法论。

Diátaxis 的核心观点是：**文档的读者处于不同状态，不同状态的需求根本不同**，把它们混在一起是文档混乱的根源。它用两个维度划分所有文档：

```
                 学习导向          ←→          工作导向
实践性    │  tutorials           │  how-to/
          │  （跟着做，学原理）    │  （解决具体问题）
──────────┼──────────────────────┼──────────────────
理论性    │  explanation/        │  reference/
          │  （理解为什么）        │  （查找信息）
```

本项目采用其中三类（`reference/`、`how-to/`、`explanation/`），并在此基础上补充了工程实践中常见的两类（`adr/`、`rfcs/`）。

---

## 目录一览

```
docs/
├── INDEX.md          # 所有文档的导航索引（快速找文件）
├── GUIDE.md          # 本文：目录结构说明与写文档的规范
│
├── reference/        # 查阅类：架构、API、规格        ← Diátaxis
├── how-to/           # 操作类：解决具体任务的步骤     ← Diátaxis
├── explanation/      # 理解类：背景与设计理由         ← Diátaxis
├── adr/              # 已落地的架构决策记录
├── rfcs/             # 提案（尚未实现的设计）
└── archive/          # 历史归档（只读）
```

另有两个文档不在 `docs/` 内，但属于项目文档体系：

- **`harness/README.md`**：开发调试工具说明，与脚本同目录（就近原则）
- **`CONTRIBUTING.md`**（项目根）：向协作者描述问题的规范

---

## 各目录详解

### `reference/` — 查阅类

**用途**：需要反复查阅的稳定信息，回答「这是什么」「在哪里」「怎么定义的」。

| 文件 | 内容 |
|------|------|
| `architecture.md` | 系统架构、目录结构、调用链、Pipeline 阶段、设计决策 |
| `api.md` | HTTP API 路由、参数、reset_scope 语义 |
| `design-system.md` | 前端设计系统（颜色、字体、组件约定） |

**什么时候更新**：修改了架构、新增了 API 路由、改变了设计规范时，同步更新对应文件。

**不放什么**：操作步骤（放 `how-to/`）、历史决策（放 `adr/`）。

---

### `how-to/` — 操作类

**用途**：解决一个具体任务的步骤，回答「我要做 X，怎么操作」。读者知道自己要做什么，只需要步骤。

| 文件 | 内容 |
|------|------|
| `deploy.md` | 新机器/新环境部署：依赖、配置、安装、启动 |

**什么时候新增**：有新的操作场景需要文档化时（如「如何迁移数据库」「如何配置 CI」）。

**不放什么**：概念解释（放 `explanation/` 或 `reference/`）、决策背景（放 `adr/`）。

---

### `explanation/` — 理解类

**用途**：解释「为什么」，帮助读者建立对某个设计或约定的理解。不包含操作步骤。

| 文件 | 内容 |
|------|------|
| `git-workflow.md` | GitFlow 分支策略：为什么用 staging、为什么禁止 fast-forward |

**什么时候新增**：某个约定或设计让人困惑，需要上下文才能理解时。

**不放什么**：命令步骤（放 `how-to/`）、具体决策记录（放 `adr/`）。

---

### `adr/` — 架构决策记录（ADR）

**ADR（Architecture Decision Record）**：记录一个已落地的重大技术决策。

**用途**：回答「当初为什么这么设计」。决策一旦写入即视为已定，不再修改；若决策被推翻，写一条新 ADR 标注 `superseded by`。

**文件命名**：`YYYY-MM-DD-<topic>.md`

| 文件 | 内容 |
|------|------|
| `2026-04-13-mode-redesign.md` | Task mode 系统重设计（media/audio/transcript/full） |
| `2026-03-15-electron-modal-stacking.md` | Electron 全局弹窗层叠稳定性方案 |

**固定结构**：

```markdown
# ADR: <标题>

**日期**: YYYY-MM-DD
**状态**: accepted | superseded by [xxx]

## 背景
## 决策
## 理由
## 影响
```

**什么时候新增**：做了一个不明显的技术选择，且这个选择会影响未来代码时（如：为什么用 SQLite 而不是文件、为什么串行不并行）。

---

### `rfcs/` — 提案

**RFC（Request for Comments）**：记录已调研但暂不实现的设计想法。

**用途**：保留设计思路，避免日后重复调研。状态为 `proposed`，实现后升级为 ADR 或直接归档。

**文件命名**：`YYYY-MM-DD-<topic>.md`

| 文件 | 内容 |
|------|------|
| `2026-03-17-writing-engine-model-config.md` | OpenCode 模型可配置化设计（未实现） |

**什么时候新增**：调研了一个方案但决定暂缓，想留存设计思路时。

---

### `archive/` — 历史归档

**用途**：存放所有已完成的历史设计文档（71 个，2026-03 ~ 2026-04），仅供回溯，不再更新。

**规则**：不要修改 archive 内的文件。需要参考历史决策时，直接阅读；若要修改行为，写新的 ADR 或 RFC。

---

## 命名规范

### 长期文档（reference / how-to / explanation）

```
<topic>.md          # 纯 kebab-case，无日期
```

日期由 git history 提供，文件名不需要重复。

### 有时间意义的文档（adr / rfcs / archive）

```
YYYY-MM-DD-<topic>.md
```

日期有意义：ADR 的顺序反映决策的演进，RFC 的日期标记调研时间点。

### 项目根级文档

```
SCREAMING_SNAKE_CASE.md    # INDEX.md、GUIDE.md、CONTRIBUTING.md
```

与 README.md、CHANGELOG.md 等项目惯例保持一致。

---

## 写文档的判断流程

```
需要写文档了？
  │
  ├─ 别人需要「查」这个信息（反复用）？
  │    └─ reference/
  │
  ├─ 别人需要「做」某个操作？
  │    └─ how-to/
  │
  ├─ 别人需要「理解」某个设计背景？
  │    └─ explanation/
  │
  ├─ 我们做了一个重大技术决策，已落地？
  │    └─ adr/YYYY-MM-DD-topic.md
  │
  ├─ 有个设计想法，暂不实现？
  │    └─ rfcs/YYYY-MM-DD-topic.md
  │
  └─ 什么都不是，只是记录历史？
       └─ archive/（或不写）
```

---

## 不应该放在 `docs/` 的内容

| 内容类型 | 正确位置 |
|---------|---------|
| 代码约定、架构、文件路径 | 可从代码推导，无需文档化 |
| git 历史、谁改了什么 | `git log` / `git blame` |
| 调试方案、修复步骤 | 修复已在代码里；commit message 有上下文 |
| 当前进行中的任务 | issue tracker 或 TODO |
| 脚本的使用说明 | 脚本同目录的 README.md（就近原则） |
