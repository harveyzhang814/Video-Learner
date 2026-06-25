# Release Profile
<!-- 由 project-release skill Init 阶段生成，可随时手动编辑 -->
<!-- 生成时间：2026-06-25 -->

## 分支模型

GitFlow，两条长期分支 `master`（生产）和 `staging`（集成），临时分支 `feature/*` / `hotfix/*` / `release/*`。

**发版流向：**

1. 当前在 `staging` 分支，确认所有功能已合并
2. 从 `staging` 切出 `release/x.y.z` 分支（版本文件改动在此分支做）
3. 合并 `release/x.y.z` → `staging`（--no-ff）
4. 合并 `staging` → `master`（--no-ff）
5. 在 `master` 上打 tag `vX.Y.Z`（annotated）

**合并规则（强制）：** 所有合并到 `staging` / `master` 必须 `--no-ff`，禁止 fast-forward。

**保护分支：** `master` 和 `staging` 禁止直接提交。

**hotfix 特殊流向：** `hotfix/*` 从 `master` 切出，完成后同时 --no-ff 合并到 `master` 和 `staging`。

## 版本文件

三个 `package.json` 同步更新到同一版本号，lockfile 由 `npm install` 自动更新。

| 文件 | 更新方式 |
|------|----------|
| `package.json` | 直接编辑 `"version"` 字段 |
| `electron/package.json` | 直接编辑 `"version"` 字段 |
| `web/package.json` | 直接编辑 `"version"` 字段 |
| `package-lock.json` | `npm install`（根目录）自动更新 |
| `electron/package-lock.json` | `cd electron && npm install` 自动更新 |
| `web/package-lock.json` | `cd web && npm install` 自动更新（如有依赖变化则提交） |
| `CHANGELOG.md` | 手动编辑：将 `[Unreleased]` 内容移至新版本区段 |

**注意：** `CHANGELOG.md` 目前没有 `[Unreleased]` 区段。发版时需先补写本次变更，再移动到有版本号的区段。

## 发布方式

无 CI/CD，完全手动。

```bash
# 1. 推送所有分支和 tag（用户手动执行）
git push origin release/x.y.z
git push origin staging
git push origin master
git push origin vX.Y.Z

# 2. 打包分发
npm pack                        # 生成 video-learner-x.y.z.tgz
# 然后手动分发 .tgz 文件
```

## 特殊规则

- **发版前检查：** 在创建 release 分支前，在 `staging` 上跑核心测试：
  ```bash
  npm run test:agent:core
  npm run test:orchestrator:unit
  npm run test:cli
  ```
- **Tag 格式：** `vX.Y.Z`（annotated），例如 `git tag -a v1.2.0 -m "release: v1.2.0"`
- **Commit message 格式：** `chore: bump version to X.Y.Z`
- **合并 commit message 格式：** `merge: release/X.Y.Z into staging` / `merge: staging into master for release vX.Y.Z`
- **CHANGELOG 链接区段**（文件底部）每次发版需追加：
  `[X.Y.Z]: https://github.com/harveyzhang96/video-learner/compare/vPREV...vX.Y.Z`
- **lockfile 提交：** 只有根目录 `package-lock.json` 和 `electron/package-lock.json` 需确认提交；`web/package-lock.json` 若无依赖变化可跳过。
