# ADR: ASR 回退集成

**日期：** 2026-04-17  
**状态：** 已实施

## 背景

`subs` 步骤在没有 YouTube 字幕（原创或自动）的视频上必然失败，导致整条转录链（`vtt2md → article → summary`）被阻塞。

在此之前，通过独立实验脚本 `experiments/whisper_asr.py` 提供了 mlx_whisper 本地转录的手动绕过方案。本次设计将 ASR 作为自动回退步骤集成进正式 pipeline。

## 决策

### ASR 是回退，不是主链

`subs`（YouTube 字幕）和 `asr`（本地 Whisper 转录）都是 `vtt2md` 的前驱。`vtt2md` 使用 **OR 门**：任意一个前驱 `completed` 即可触发。

- `subs` 失败不代表任务失败——`asr` 路径仍可成功。
- `subs` 语义保持不变（无字幕时 exit 1）；调度器负责寻找替代路径。

```
fetch ──► subs ──────────────────► vtt2md ──► article ──► summary
  │                                   ▲
  ├──► video ──┐                      │
  │            ├──► asr (fallback) ───┘
  └──► audio ──┘
```

### ASR 的调度条件（动态排除）

`asr` 仅在以下条件同时满足时进入就绪集：

| 条件 | 规则 |
|------|------|
| `subs === 'failed'` | YouTube 字幕确实不可用 |
| mode ≠ `transcript` | transcript 模式无媒体文件，ASR 无法运行 |
| mode = `media`/`full` | 需要 `video.mp4` 已 `completed` |
| mode = `audio` | 需要 `audio.m4a` 已 `completed` |

`asr` 排在 `SECONDARY_CHAIN_BASE`（`video`/`audio` 之后），不在 `PRIMARY_CHAIN`。

### 媒体源优先级

`asr_transcribe.sh` 按顺序查找：`video.mp4` → `audio.m4a`，两者均缺则 exit 1。

### 输出格式

写入 `work/<id>/transcript/subs/<id>.zh.asr.vtt`——与 YouTube VTT 格式完全相同，`vtt2md` 通过 `*.vtt` glob 自动识别。

## 理由

- ASR 运行代价高（需要 mlx_whisper + 本地 GPU），不应作为默认路径。
- 将 OR 门放在调度层而非硬编码 if/else，使 DAG 结构保持声明式。
- `download_subs.sh` 不做改动，保持「语义正确地失败」——失败是正常信号，不是错误。

## 影响

- `core/orchestrator/schedule.js`：`ALL_STEPS` 加入 `asr`；`STEP_EDGES` 加入 `['fetch','asr']`、`['asr','vtt2md']`；`SECONDARY_CHAIN_BASE` 加入 `asr`；`excludedByMode` 加入 asr 条件；`GATE_TYPE.vtt2md = 'OR'`。
- `core/orchestrator/index.js`：`STEPS`/`STEP_SCRIPTS` 加入 `asr`；新增 `asr` case in `runStep`。
- 新增 `scripts/asr_transcribe.sh` / `scripts/asr_transcribe.py`（核心逻辑从 `experiments/whisper_asr.py` 提炼）。
- `experiments/whisper_asr.py` 保持不变（独立实验脚本）。
- HTTP 路由、GUI 代码不受影响（GUI 不显示 `asr` 步骤触发入口）。

## 不在范围内

- GUI 侧 `asr` 步骤触发按钮
- 语言自动检测写回 `meta.json`
- Whisper 模型按任务配置
- 完整 DAG 可达性检测（见 [adr/2026-04-18-dag-reachability.md](2026-04-18-dag-reachability.md)）
