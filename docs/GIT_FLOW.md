# Git 分支管理规范

## 概述

本项目采用 GitFlow 工作流管理分支，确保代码质量和发布稳定性。

## 合并策略（强制）

- **禁止 fast-forward 合并**：将 `feature/*`、`hotfix/*` 合并进 `staging` 或 `master` 时，**必须**使用 **`git merge --no-ff`**，以便保留合并提交、明确功能边界，并在历史上可追溯「哪次合并带入了哪条分支」。
- **禁止依赖**默认的 fast-forward（即不要对这类合并使用无 `--no-ff` 的 `git merge`，以免线性历史吞掉分支信息）。
- 合并时建议写清合并说明，例如：`git merge --no-ff feature/xxx -m "merge: feature/xxx into staging"`。

## 分支类型

| 分支 | 用途 | 命名规则 | 生命周期 |
|------|------|----------|----------|
| `master` | 主分支，生产环境代码 | - | 永久 |
| `staging` | 测试分支，集成所有功能 | - | 永久 |
| `feature/*` | 功能开发分支 | `feature/功能名` | 临时 |
| `hotfix/*` | 紧急修复分支 | `hotfix/问题描述` | 临时 |

## 分支职责

### master (主分支)
- **用途**: 生产环境代码
- **推送**: 仅接受来自 `staging` 和 `hotfix` 分支的合并
- **创建**: 项目初始化时创建
- **保护**: 禁止直接提交，必须通过 PR 合并

### staging (测试分支)
- **用途**: 测试环境，用于集成测试
- **合并**: 接收所有 `feature/*` 分支的合并
- **推送**: 负责向 `master` 发起合并请求
- **创建**: 从 `master` 创建

### feature/* (功能分支)
- **用途**: 开发新功能或修改
- **创建**: 从 `staging` 创建
- **合并**: 完成后合并回 `staging`
- **命名**: `feature/功能名称`，如 `feature/add-user-auth`

### hotfix/* (紧急修复分支)
- **用途**: 修复生产环境紧急问题
- **创建**: 从 `master` 创建
- **合并**: 完成后同时合并到 `master` 和 `staging`
- **命名**: `hotfix/问题描述`，如 `fix-login-bug`

## 工作流程

```
master    ──────────────────────────────────────►
           ▲                ▲
           │    ▲            │    ▲
           │    │            │    │
staging    ─┴────┴────────────┴────┴─────────────►
           ▲          ▲          ▲
           │          │          │
feature/a  ┴──────────┴          │
                          ┌──────┴──────┐
                          │             │
feature/b                 │             │
           ───────────────┘             │
                                         │
hotfix/fix                              │
           ──────────────────────────────┘
```

## 操作命令

### 1. 开始新功能

```bash
# 从 staging 创建功能分支
git checkout staging
git pull origin staging
git checkout -b feature/功能名称
```

### 2. 开发完成合并到 staging

```bash
# 切换到功能分支，开发完成后
git checkout staging
git pull origin staging
git merge --no-ff feature/功能名称 -m "merge: feature/功能名称 into staging"
git push origin staging
# 删除功能分支
git branch -d feature/功能名称
```

### 3. 发布到生产

```bash
# 从 staging 合并到 master
git checkout master
git pull origin master
git merge --no-ff staging -m "merge: staging into master for release"
git push origin master
```

### 4. 紧急修复

```bash
# 从 master 创建 hotfix 分支
git checkout master
git checkout -b hotfix/问题描述

# 修复完成后，同时合并到 master 和 staging
git checkout master
git merge --no-ff hotfix/问题描述 -m "merge: hotfix into master"
git push origin master

git checkout staging
git merge --no-ff hotfix/问题描述 -m "merge: hotfix into staging"
git push origin staging

# 删除 hotfix 分支
git branch -d hotfix/问题描述
```

## 分支保护规则

### master 分支
- 禁止直接推送
- 必须通过 Pull Request 合并
- 需要至少 1 人 code review

### staging 分支
- 建议同样通过 PR 合并
- 保持与 master 同步

## 注意事项

1. **永远不要**从 `feature/*` 直接合并到 `master`
2. **永远不要**在 `master` 上直接开发
3. **始终**保持 `staging` 是 `master` 的超集
4. **hotfix** 完成后需要同时合并到 `master` 和 `staging`
5. 功能分支开发前，先拉取最新的 `staging` 代码
