#!/usr/bin/env bash
# DEPRECATED: 一键 CLI 入口已废弃。正式流程仅通过 GUI（Electron）或 Agent Service（HTTP → core/orchestrator）。
# 本文件保留路径以便旧文档/书签仍指向可读说明；执行即失败，不再跑任何流水线步骤。

set -euo pipefail

cat >&2 <<'EOF'
[DEPRECATED] scripts/run.sh 已废弃，请改用：

  桌面客户端（推荐）
    bash start-electron.sh
    或: npm start

  本地 HTTP 编排（Agent Service）
    npm run agent:serve
    然后使用 POST /api/tasks 等接口（见 docs/PROJECT_KNOWLEDGE.md）

  端到端测试（与 HTTP 编排一致）
    npm run test:agent:e2e
    可选: E2E_PIPELINE_MODE=transcript E2E_YOUTUBE_URL="https://..." npm run test:agent:e2e
    详见 tests/agent-service-e2e.test.js 文件头注释。

流水线实现位于 core/orchestrator 与各 scripts/<step>.sh，请勿再依赖本脚本。
EOF

exit 1
