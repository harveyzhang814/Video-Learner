# ADR: Task Mode System Redesign

**日期**: 2026-04-13
**状态**: implemented

## 背景

原有 mode 系统（`both` / `video` / `audio` / `transcript`）存在两个问题：

1. `both` 和 `video` 功能完全相同 — `both` 模式下 `audio` 步骤被排除调度，从未生成独立的 `audio.m4a`。
2. 没有「智能回退」模式：视频下载失败后，任务没有任何媒体产出。

核心流水线（Transcript + Article + Summary）始终必须执行，mode 只控制**下载哪些媒体文件**。

## 决策

用 `media` / `audio` / `transcript` / `full` 替代原有 mode：

| Mode | 媒体行为 | 频率 | 默认 |
|------|---------|------|:----:|
| `media` | 优先下载视频；视频失败或缺失时，自动回退下载音频 | 最高 | ✓ |
| `audio` | 仅下载音频 | 中 | |
| `transcript` | 不下载媒体 | 中 | |
| `full` | 独立下载视频和音频（两步均运行，互不阻塞） | 最低 | |

### 旧 → 新名称映射

| 旧名称 | 新名称 |
|--------|--------|
| `both` | `media` |
| `video` | `media` |
| `audio` | `audio`（不变） |
| `transcript` | `transcript`（不变） |

### 兼容性

`normalizeMode(raw)` 函数在所有读取路径（HTTP 请求体、DB 加载）上执行转换：

```
'both' | 'video' | 'media' → 'media'
'audio'                    → 'audio'
'transcript'               → 'transcript'
'full'                     → 'full'
unknown / empty            → 'media'  (默认)
```

一次性 DB 迁移脚本 `scripts/migrate-mode-names.js`（幂等）在 HTTP server 启动时自动执行：

```sql
UPDATE tasks SET mode = 'media' WHERE mode IN ('both', 'video');
```

## 理由

- `both` 与 `video` 的冗余增加认知负担，合并为语义更清晰的 `media`
- `media` 模式的音频回退解决了「视频失败后无媒体产出」的问题，无需用户手动切换 mode
- `full` 模式满足需要同时保留视频和音频文件的场景
- `normalizeMode` 在入口处转换保证了向后兼容，旧客户端无需修改

## 影响

### 调度层变更（`core/orchestrator/schedule.js`）

`excludedByMode(mode, steps?)` 新增 `steps` 参数（可选），用于 `media` 模式动态解锁 `audio`：

```
media 模式:
  - video 未失败 → audio 被排除
  - video 已失败 → audio 加入调度（触发回退）

audio 模式:      video 排除
transcript 模式: video + audio 排除
full 模式:       不排除任何步骤（video 和 audio 均可调度；video 优先级更高）
```

### 步骤状态流（media 模式）

```
fetch: completed
  → video: pending → running → failed
      ↓  (下次 computeReadySteps 检测到 video.failed)
  → audio: pending → running → completed | failed
```

### API 变更

- `POST /api/tasks` body：`mode` 接受 `media | audio | transcript | full`
- 旧值 `both | video` 通过 `normalizeMode()` 静默转换，不返回错误
- 响应 `meta.mode` 始终返回规范化后的新名称

### 测试覆盖

| 文件 | 变更 |
|------|------|
| `tests/orchestrator-schedule.test.js` | 新增：`media` 模式 video 失败 → audio 触发；`full` 模式两步同时就绪 |
| `tests/apply-reset-scope.test.js` | 新增：`media` 模式 video 失败后 audio 可作为 reset anchor |
| `tests/reset-scope-all-steps-http.test.js` | 更新 `MODES` 列表和 `excludedByMode` 断言 |
| `tests/agent-http.test.js` | 新增：旧名称 `both` 和 `video` 静默接受并规范化 |

### 超出范围（不在此次实现内）

- GUI mode 选择器标签变更（独立 UI 任务）
- `download_audio.sh` 的 `force` 参数 bug（已知问题，见 `reference/architecture.md` §4.1.1）
- `full` 模式下 video + audio 的真正并行执行（当前串行调度；真并行为未来增强）
