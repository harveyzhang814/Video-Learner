#!/usr/bin/env bash
# Full end-to-end：经本地 HTTP 编排（与 tests/agent-service-e2e.test.js 一致）。
# 需外网、yt-dlp、ffmpeg 及写作引擎（WRITING_ENGINE / settings.conf）；详见该测试文件头注释。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export E2E_PIPELINE_MODE="${E2E_PIPELINE_MODE:-transcript}"
exec npm run test:agent:e2e
