# Video-Learner 项目知识文档

> 本文面向「后来者」和「未来的自己」，希望在几分钟内弄清整个项目在做什么、长什么样、以及关键约束是什么。

---

## 一、项目概述

**Video-Learner** 是一个 YouTube 视频处理流水线工具，实现了从单个 YouTube URL 到「下载 → 字幕/转录 → 结构化文章 → 重点总结」的自动化流程，并同时支持：

- **命令行一键模式**：通过 `scripts/run.sh` 一口气跑完整条流水线；
- **Electron 桌面客户端**：通过 GUI + 本地 orchestrator + SQLite，对流水线各步骤进行可视化编排与重试。

**核心能力：**

1. **视频/音频下载**：使用 `yt-dlp` 下载最高 1080p（不追求 4K），支持后台独立下载。
2. **双语字幕获取**：自动检测并下载中/英字幕，优先原创字幕，其次自动字幕。
3. **转录生成**：将 VTT 字幕转换为带 \[mm:ss\] 时间戳、自动去重的 Markdown 逐字稿。
4. **文章整理**：用 Claude 将逐字稿整理为结构化的 `article.md`。
5. **智能总结**：结合用户 FOCUS，生成包含 TL;DR / Outline / Key Points / Action Items / Terms 的 `summary.md`。
6. **任务管理 & GUI**：Electron 前端配合本地 orchestrator 和 WebSocket，提供任务列表、进度与日志流、双语字幕切换等能力。

---

## 二、目录结构与职责

只列出关键目录与文件，省略若干测试脚本与杂项：

```bash
Video-Learner/
├── CLAUDE.md                  # 流水线执行标准 & meta 约定（强约束）
├── README.md                  # 对外 README（简略版）
├── package.json               # 根级 NPM 脚本：启动 Electron、安装依赖
├── scripts/                   # CLI 流水线 + 分步脚本 + 工具
│   ├── run.sh                 # CLI 主入口，一体化流水线
│   ├── install.sh             # 安装系统依赖（yt-dlp / ffmpeg / jq / sqlite3 / claude CLI 等）
│   ├── fetch_info.sh          # Electron 路径：Step fetch（yt-dlp 拉取基础信息）
│   ├── download_video.sh      # Step video：视频下载（合并流 + DASH 回退）
│   ├── download_audio.sh      # Step audio：音频下载/提取
│   ├── download_subs.sh       # Step subs：字幕下载（中/英）
│   ├── convert_vtt_md.sh      # Step vtt2md：VTT → Markdown 的封装
│   ├── convert_md_vtt.sh      # Step md2vtt：Markdown → VTT 的封装
│   ├── generate_article.sh    # Step article：调用 Claude 生成 article.md
│   ├── generate_summary.sh    # Step summary：调用 Claude 生成 summary.md
│   ├── vtt_converter.py       # 纯 Python：VTT → Markdown（去重/清洗）
│   ├── md2subtitle.py         # 纯 Python：Markdown → VTT/SRT
│   ├── db.sh                  # Bash 侧 SQLite 工具（tasks/steps/downloads）
│   ├── settings.example.conf  # 全局配置样例（输出语言、画质等）
│   ├── article_prompt.txt     # Claude 文章提示词模板
│   ├── summary_prompt.txt     # Claude 总结提示词模板
│   └── test_*.sh / test_*e2e.sh # 若干端到端/集成测试脚本
├── electron/                  # Electron 桌面客户端 & Orchestrator
│   ├── package.json
│   └── src/
│       ├── main.js            # Electron 主进程，创建窗口 & IPC & WebSocket
│       ├── preload.js         # 暴露安全 API 给前端
│       ├── db.js              # Node 侧 SQLite 封装（操作 work/database.sqlite）
│       ├── websocket-server.js# 本地 WebSocket server，向前端推日志和状态
│       ├── orchestrator.js    # Orchestrator：按步骤调用 scripts/* 并更新 DB
│       └── renderer/
│           └── index.html     # 前端 UI（任务列表、详情、播放器、字幕区等）
├── docs/
│   ├── PROJECT_KNOWLEDGE.md   # 本文：项目知识总览
│   ├── GIT_FLOW.md            # 分支规范：仅在 feature/* 或 hotfix/* 开发
│   └── plans/                 # 历史设计文档与实现笔记（orchestrator / vtt 去重等）
├── start-electron.sh          # 从仓库根目录启动 Electron 的脚本
└── work/                      # 运行时输出（执行后生成，不纳入版本控制）
    ├── index.jsonl            # CLI 模式任务索引（按行记录任务概况）
    ├── database.sqlite        # Electron 模式下的任务/步骤状态数据库
    └── <id>/                  # 单个 URL 的输出树（id = sha1(url) 前 12 位）
        ├── media/             # 媒体文件
        │   ├── video.mp4
        │   ├── audio.m4a
        │   └── video_download.log
        ├── transcript/        # 转录与字幕
        │   ├── subs/          # 原始字幕 vtt（区分 en/zh、orig/auto）
        │   ├── original_en.md # 英文逐字稿（带 [mm:ss]；去重）
        │   ├── original_zh.md # 中文逐字稿
        │   ├── original_en.vtt
        │   └── original_zh.vtt
        └── writing/           # 生成内容
            ├── article.md     # 结构化文章
            └── summary.md     # 总结（受 FOCUS 影响）
```

---

## 三、两种运行模式：CLI vs Electron

项目当前存在两套「等价逻辑、不同表现形式」的流水线实现：

- **CLI 模式（偏自动脚本 & 批处理）：**
  - 入口：`bash scripts/run.sh "<URL>" ...`
  - 特点：单脚本串行调度所有步骤，状态主要靠「已有文件 + `work/index.jsonl`」推断，适合命令行一键跑完。
- **Electron GUI 模式（偏交互 & 可视化）：**
  - 入口：`bash start-electron.sh` 或 `cd electron && npm start`
  - 特点：通过 `electron/src/orchestrator.js` 拆分为多个可独立重试的 Step，状态持久化在 `work/database.sqlite`，前端通过 WebSocket 实时看到进度与日志。

> 记忆点：**业务逻辑基本一致，差异集中在「状态存储」与「入口形式」上。**

### 3.1 运行入口约定（重要）

- **正式入口**：
  - 目前所有正式的 **GUI（Electron）** 与 **Agent Service（HTTP 服务）** 均通过编排层入口 `core/orchestrator` 进行控制与调度。
- **CLI 入口定位**：
  - `scripts/run.sh` 目前主要用于**人工测试/手工批处理**，不作为正式流程入口（正式流程以编排层为准）。
- **未来演进原则**：
  - 未来新增功能与步骤编排，优先/统一通过 **编排层（`core/orchestrator`）** 实现，以避免“CLI 与 GUI 双实现”持续分叉。

---

## 四、CLI 主流水线（scripts/run.sh）

### 4.1 参数与调用方式

```bash
bash scripts/run.sh "<URL>" \
  [LANG=auto] \
  [OUTPUT_LANG=zh-CN|en] \
  [MODE=both|video|audio|transcript] \
  [FORCE=0|1] \
  [FOCUS="你关心的重点"]
```

- **`LANG`**：优先字幕语言检测策略（目前多为 `auto`）。
- **`OUTPUT_LANG`**：输出文本语言，默认 `zh-CN`，可在配置/技能里扩展。
- **`MODE`**：
  - `both`：下载 + 转录 + 文章 + 总结（默认）
  - `video`：仅视频/音频相关
  - `audio`：仅音频
  - `transcript`：仅字幕/转录 + 文章 + 总结（不强制下视频）
- **`FORCE`**：
  - `0`：复用已完成的步骤，跳过已有成果
  - `1`：强制从头重跑对应阶段
- **`FOCUS`**：用户意图（技术细节 / 主要论点 / 行动项 / 架构分析……），会透传到 summary 提示词。

### 4.2 执行阶段（逻辑视角）

1. **Step 0：获取信息（info/fetch）**
   - 使用 `yt-dlp --dump-json` 拉取标题、时长、语言等。
   - 计算 `id = sha1(url)` 前 12 位，建立 `work/<id>/` 目录。
   - 在 CLI 模式下，轻量记录到 `work/index.jsonl`。

2. **Step 1：视频下载（video，后台独立）**
   - `run.sh` 使用 `nohup bash scripts/download_video.sh ... &` 方式后台启动。
   - 下载策略：
     - 优先合并格式（progressive）：单 MP4 文件（bestvideo+bestaudio，最高 1080p）。
     - 失败时回退到 DASH：分别下载视频/音频流，再用 `ffmpeg` 合并。
   - 结果落盘：
     - `work/<id>/media/video.mp4`
     - `work/<id>/media/video_download.log`
   - **关键：下载失败不阻塞后续转录/总结。**

3. **Step 2：音频下载/提取（audio）**
   - 使用 `yt-dlp -x --audio-format m4a`。
   - 输出 `work/<id>/media/audio.m4a`，供未来接入 ASR 使用。

4. **Step 3：字幕下载 + 转录（subs + vtt2md）**
   - 语言与优先级：
     - 英文：`en-orig` > `en`（auto）
     - 中文：`zh-Hans`/`zh-Hant`（orig/auto）> `zh`（auto）
   - 字幕下载：`yt-dlp --write-subs/--write-auto-subs` + `--sub-langs`。
   - 转录：
     - `vtt_converter.py`：VTT → `original_en.md` / `original_zh.md`（\[mm:ss\]，去重）。
     - `md2subtitle.py`：反向生成 `original_en.vtt` / `original_zh.vtt`，方便前端播放。

5. **Step 3.5：文章生成（article）**
   - 源文件：优先 `original_en.md`，否则 `original_zh.md`。
   - 模板：`scripts/article_prompt.txt`。
   - 工具：Claude CLI（`claude` 命令）。
   - 输出：`work/<id>/writing/article.md`。

6. **Step 4：总结生成（summary）**
   - 源文件：`writing/article.md`。
   - 模板：`scripts/summary_prompt.txt`。
   - 输入：FOCUS（命令行参数 / 之前记录）。
   - 输出：`work/<id>/writing/summary.md`。

### 4.3 CLI 模式下的状态与复用

- **任务索引：`work/index.jsonl`**
  - 每行一条 JSON，记录 `url/id/ts/title` 以及若干状态字段（下载/转录/文章/总结是否完成）。
  - 同一 `id` 多次执行时，会合并更新记录而不是追加重复行。
- **文件存在性即状态**：
  - `video.mp4` 存在且大小 > 阈值 → 视为已成功下载，可标记 `download_status=skipped_existing`。
  - `original_en/zh.md` 存在且内容长度 > 阈值，且 `FORCE=0` → 视为转录已完成，只做后续文章/总结。

---

## 五、Electron Orchestrator & GUI 流水线

### 5.1 总体架构

- **主进程（`electron/src/main.js`）**
  - 创建应用窗口。
  - 初始化 WebSocket server 与 orchestrator。
  - 暴露若干 IPC 通道给 renderer（前端页面）。

- **Orchestrator（`electron/src/orchestrator.js`）**
  - 将一条流水线拆分为多个可单独执行的 Step：
    - `fetch` / `video` / `audio` / `subs` / `vtt2md` / `md2vtt` / `article` / `summary`。
  - 每步调用对应的 `scripts/*.sh`，并通过 `db.js` 更新 SQLite 中的 `tasks` / `steps` / `downloads`。
  - 提供高层 API：
    - `run(url, options)`：按顺序执行所有启用的 Step。
    - `runStep(taskId, stepName, options)`：单步重试或补跑。

- **SQLite 状态存储（`work/database.sqlite`）**
  - 主要表结构（简化）：
    - `tasks`：任务级信息（url / title / duration / created_at / focus / output_lang 等）。
    - `steps`：按 step 维度记录 `status`（pending/running/completed/failed）、`attempts`、`error` 等。
    - `downloads`：视频下载详情（文件大小、格式、错误信息等）。

- **WebSocket 通信（`electron/src/websocket-server.js`）**
  - 将 orchestrator 的事件（日志输出、任务创建/更新、步骤开始/结束等）通过 WebSocket 推送给前端。
  - 前端订阅这些事件，实现进度条、日志流、状态标签等 UI。

### 5.2 前端（renderer/index.html）视角

典型布局（三栏 + 中间列四段式）：

- **左侧**：任务列表（按时间排序，可点击选中）。
- **中间**（自上而下，用简单分割线隔开）：
  - **主信息区**：仅展示当前任务「标题」「URL」两行，与状态条、内容区左对齐（统一 padding）。
  - **状态条**：独立于主信息区的一行，上下有分割线；展示各 Step 的紧凑 tag pill（获取信息 / 视频下载 / 字幕 / 文章 / 总结等），主界面与 Manage 弹窗样式一致。
  - **内容卡功能栏**：Article / Summary 切换控件（样式与字幕语言切换一致：浅灰底、选中深色）。
  - **内容卡内容区**：Article 或 Summary 的 Markdown 正文，由 `marked` 渲染，该区域单独滚动。
- **右侧**：视频播放器（本地 `file://` 播放 `work/<id>/media/video.mp4`）+ 控制条 + 字幕模块（多轨 VTT 列表、可点击跳转、与播放时间联动高亮、可选「画面内字幕」开关）。中间列与右侧之间、右侧内部「视频+控制条」与「字幕列表」之间均有可拖拽分割条；右侧高度随宽度按视频实际宽高比（如 16:9）约束。

前端通过 **HTTP API**（`services/http-server`）与 **preload 暴露的 service 信息** 调用：

- 创建任务、查询任务、执行/重试某 Step（HTTP）；
- **GET /api/tasks/:taskId/media**：返回 `video.path`、`video.exists`，前端拼 `file://` 给 `<video>.src`；
- **GET /api/tasks/:taskId/subtitles**：一次性返回多轨 `{ tracks: [{ id, lang, label, vtt }] }`，前端解析 VTT、渲染列表、可选注入 TextTrack 做画面内字幕；
- **GET /api/tasks/:taskId/result/content?type=article|summary**：返回对应 Markdown 正文，前端用 `marked` 渲染到内容区；
- 任务列表与步骤状态通过 **SSE**（`/api/events?token=...`）实时刷新。

### 5.3 GUI 下载失败排查

GUI 里「视频/音频下载」失败时，可先看任务详情中的**步骤错误信息**（失败步骤旁的红色文案或日志），再按下面三类判断：

| 类型 | 典型表现 | 处理建议 |
|------|----------|----------|
| **资源问题** | 日志里出现 yt-dlp 的 HTTP/429、地区限制、视频不可用、网络超时等 | 换网络/VPN、换 URL、或改用「仅字幕」不下载媒体 |
| **Bash/脚本** | 日志里出现 `syntax error`、`No such file`、脚本路径或参数错误 | 检查 `scripts/download_video.sh`、`scripts/db.sh` 与 `work/<id>/media/` 路径是否正确；同一 URL 用 CLI `bash scripts/run.sh "<URL>" MODE=both` 对比 |
| **架构/环境** | 日志里出现 `command not found`、`yt-dlp: not found`、`ffmpeg: not found` | Electron 子进程未继承完整 PATH。主进程已通过 `_spawnEnv()` 注入 `/usr/local/bin`、`/opt/homebrew/bin` 等；若仍报错，在终端执行 `which yt-dlp ffmpeg`，把所在目录加入系统 PATH 或重装依赖（如 `brew install yt-dlp ffmpeg`）后重启应用 |

同一 URL 在**终端**用 `bash scripts/run.sh "<URL>"` 能成功、在 **GUI** 失败，多为架构/环境（PATH）；两端都失败多为资源或脚本。

**YouTube 人机验证（"Sign in to confirm you're not a bot"）**：在 `scripts/` 下复制 `settings.example.conf` 为 `settings.conf`，取消注释并设置 `YT_DLP_COOKIES_BROWSER=chrome`（或 `safari`/`firefox`/`edge`），或设置 `YT_DLP_COOKIES_FILE=/path/to/cookies.txt`。所有调用 yt-dlp 的脚本会通过 `scripts/yt-dlp-cookies.sh` 自动带上该配置。

---

## 六、数据与输出结构（逻辑层）

这一部分与 `CLAUDE.md` 中的定义保持一致，是项目的「契约」：

```bash
work/
├── index.jsonl                    # CLI 模式：每次运行追加或更新一条记录
├── database.sqlite                # Electron 模式：任务/步骤/下载状态数据库
└── <id>/                          # id = sha1(url) 前 12 位
    ├── media/
    │   ├── video.mp4              # 视频文件（若下载成功）
    │   ├── audio.m4a              # 音频文件
    │   └── video_download.log     # 下载日志
    ├── transcript/
    │   ├── subs/                  # VTT 字幕原始文件
    │   ├── original_en.md         # 英文逐字稿（去重）
    │   ├── original_zh.md         # 中文逐字稿
    │   ├── original_en.vtt
    │   └── original_zh.vtt
    └── writing/
        ├── article.md             # 结构化文章
        ├── summary.md             # 总结
        └── summary_prompt.txt     # （部分路径下存在）总结提示词快照
```

> 实际代码中，CLI 模式更多是用内存中的 `META` 结构 + 以上文件存在与否来体现「meta.json」的含义；Electron 模式则用 SQLite 结构化表达这些状态。`CLAUDE.md` 对 `meta.json` 字段的说明，应被视为**逻辑 schema 约定**。

---

## 七、逻辑 meta 结构（来自 CLAUDE.md）

逻辑上，一个任务在任意运行模式下，都近似满足以下字段约定（简化自 `CLAUDE.md`）：

```json
{
  "url": "...",
  "id": "...",
  "ts": "...",
  "title": "...",
  "duration": "...",
  "lang": "...",
  "output_lang": "zh-CN|en",
  "download_status": "pending|success|failed|skipped_existing",
  "download_attempts": 0,
  "download_error": "...",
  "transcript_source": "youtube_transcript|subtitle|existing|asr_missing|none",
  "transcript_done": true,
  "article_done": true,
  "article_prompt_path": "...",
  "summary_done": true,
  "focus": "...",
  "focus_needed": true,
  "claude_summary_pending": true,
  "tool_versions": { "yt_dlp": "...", "ffmpeg": "...", "jq": "..." }
}
```

在实际实现中：

- **CLI 模式**：更偏向「轻量 meta」+ `index.jsonl` + 文件存在性判断；
- **Electron 模式**：将这些字段拆分到 `tasks` / `steps` / `downloads` 多张表中；
- **文档层面**：`CLAUDE.md` 中的 `meta.json` 结构，是后续实现与演进要遵守的共享契约。

---

## 八、关键设计决策与失败策略

### 8.1 视频下载独立性

- 视频下载成功/失败 **不影响** transcript 获取和总结：
  - 下载失败时，仍然会尝试字幕/转录 + 文章 + 总结；
  - 用户至少能获得「这视频讲了什么」，即便本地没有完整视频文件。

### 8.2 下载重试与质量策略

- **重试策略：**
  - 第一次失败 → 立刻重试一次（清理半成品后重新下载）。
  - 第二次仍失败 → 放弃下载，记录 `download_status=failed` 与 `download_error`。
- **质量策略：**
  - 默认目标：最高 1080p（不追求 4K，以稳定性和速度优先）。
  - 优先下载 progressive 合并流；
  - 无法合并则改为 DASH 分离流 + `ffmpeg` 合并。

### 8.3 双语字幕处理与回退

- **语言优先级：**
  - 英文：`en-orig` > `en`（auto）
  - 中文：`zh-Hans`/`zh-Hant`（original/auto）> `zh`（auto）
- **来源字段：**
  - `transcript_source`：`youtube_transcript` / `subtitle` / `existing` / `asr_missing` / `none`。
  - 若有音频但无字幕 → 典型为 `asr_missing`，为未来对接 ASR 预留空间。

### 8.4 去重与复用

- **ID 复用：**
  - `id = sha1(url)` 前 12 位，用于：
    - 目录命名：`work/<id>/`
    - CLI 索引：`work/index.jsonl`
    - GUI 任务记录：SQLite `tasks` 表。
- **步骤复用：**
  - 已存在且「足够完整」的输出（例如：`video.mp4` 大于阈值、`original_en.md` 长度大于阈值）在 `FORCE=0` 时会被直接复用。
  - `FORCE=1` 时，即使文件存在也会重新跑对应步骤。

### 8.5 用户意图（FOCUS）

- 每次处理视频时，应尽可能获取用户 FOCUS：
  - 示例：技术细节、主要论点、行动项、关键术语、架构分析……
- FOCUS 影响：
  - `summary.md` 的侧重点；
  - Claude 提示词中各部分的篇幅分配。
- 在某些模式下，会有 `focus_needed` / `claude_summary_pending` 之类逻辑：
  - 若缺少 FOCUS，则允许先暂停在「等待 FOCUS」的状态，之后用户补充 FOCUS 再生成总结。

---

## 九、依赖与环境

- **系统工具：**
  - `yt-dlp`：负责视频/音频/字幕下载。
  - `ffmpeg`：负责音视频合并与转码。
  - `jq`：负责 JSON 解析与处理。
  - `sqlite3`：负责本地状态数据库（Electron 模式）。
- **语言运行时：**
  - `bash`：所有 `scripts/*.sh` 的执行环境。
  - `python3`：`vtt_converter.py` / `md2subtitle.py` 等文本处理脚本。
  - `node` + `npm`：Electron / orchestrator / WebSocket 所需。
- **AI 相关：**
  - Claude CLI（`claude` 命令）：生成 `article.md` 和 `summary.md`，提示词由 `article_prompt.txt` / `summary_prompt.txt` 提供。

---

## 十、使用示例

### 10.1 命令行

```bash
# 最常见场景：全流程处理一个视频
bash scripts/run.sh "https://www.youtube.com/watch?v=..." \
  FOCUS="技术细节, 架构分析"

# 仅做转录与总结（不强制下完整视频）
bash scripts/run.sh "https://youtube.com/..." MODE=transcript

# 已经跑过一次，想带新 FOCUS 重新生成总结
bash scripts/run.sh "https://youtube.com/..." FOCUS="行动项, 学习路径"

# 强制从头重跑（包括覆盖已有结果）
bash scripts/run.sh "https://youtube.com/..." FORCE=1
```

### 10.2 GUI（Electron）

```bash
# 启动 Electron 客户端（推荐入口）
bash start-electron.sh

# 或手动进入 electron 目录
cd electron
npm install
npm start
```

GUI 中可：

- 输入 URL + FOCUS，勾选「下载视频/音频」等选项，创建任务；
- 观察各 Step 的状态（pending / running / completed / failed）；
- 对失败的 Step 单独重试；
- 查看 `article.md` 和 `summary.md`；
- 播放视频、在中/英字幕之间切换。

---

## 十一、总结模板结构（summary.md）

Claude 生成的 `summary.md` 一般遵循以下结构（源自 `CLAUDE.md`）：

```markdown
# Summary

## TL;DR
[一句话总结]

## Outline
1. [主要章节/要点，按时间顺序]

## Key Points
- [关键要点1] [时间戳]
- [关键要点2] [时间戳]
- [...]

## Action Items
- [行动项1]
- [行动项2]

## Terms/Entities
- [术语1]: [定义]
- [术语2]: [定义]
```

---

## 十二、Agent HTTP Service

在 **feat/agent-service** 分支上，项目增加了面向 agent 编排层（如 OpenClaw）的本地 HTTP 服务，与 CLI、Electron 共用同一套流水线逻辑与 SQLite 状态。

### 入口与目录

- **启动**：`npm run agent:serve`（根目录），默认监听 `http://localhost:3000`，可通过环境变量 `PORT` 修改。
- **相关目录**：
  - `core/id.js`：统一任务 ID 计算（`sha1(url + '\n').slice(0,12)`），与 Electron 一致。
  - `core/orchestrator/`：共用编排内核，创建任务、执行步骤、读写 `work/database.sqlite` 与 `work/<id>/`。
  - `services/http-server/`：Koa 实现的 HTTP API，调用 `core/orchestrator` 并对外暴露 JSON 接口。

### 主要路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tasks` | 创建任务（body: url, focus, mode, force, output_lang），返回 task_id；后台自动跑整条流水线。 |
| GET | `/api/tasks/:taskId` | 查询任务状态与 meta、steps。 |
| DELETE | `/api/tasks/:taskId` | 删除任务（query: mode=hard\|state\|soft，默认 hard）；成功 204。 |
| GET | `/api/tasks/:taskId/result` | 获取任务结果与输出路径（article_path、summary_path 等）。 |
| GET | `/api/tasks/:taskId/result/content?type=article\|summary` | 返回对应 Markdown 文件正文（Content-Type: text/markdown），供 GUI 渲染；仅允许 `work/<id>/writing/` 下 article.md / summary.md。 |
| GET | `/api/tasks/:taskId/media` | 返回 `{ video: { path, exists } }`，path 为 `work/<id>/media/video.mp4` 的绝对路径，供 GUI 拼 `file://` 播放。 |
| GET | `/api/tasks/:taskId/subtitles` | 一次性返回 `{ tracks: [{ id, lang, label, vtt }] }`（md2vtt 产出的 VTT 全文），供 GUI 解析并展示多轨字幕。 |
| GET | `/api/tasks/:taskId/steps` | 获取该任务所有步骤的状态列表。 |
| POST | `/api/tasks/:taskId/steps/:stepName/run` | 执行或重试指定步骤（body 可选：focus, force）。 |
| GET | `/api/events` | SSE 流（query: token），推送任务/步骤/日志事件，供 GUI 实时刷新。 |
| GET | `/api/tasks/:taskId/paths` | 返回该任务的路径信息（base/media/transcript/writing），供 Electron 等客户端打开本地输出目录。 |

### 与 CLI / Electron 的关系

- **任务 ID**：三者统一使用 `core/id.js` 的 `generateId(url)`，同一 URL 在任意入口下得到相同 `id`，对应同一套 `work/<id>/` 与 SQLite 记录。
- **状态存储**：HTTP 与 Electron 共用 `work/database.sqlite`（tasks / steps 表）；创建任务与步骤执行会持久化到 DB，进程重启后可通过 GET 或 runStep 按 taskId 从 DB 恢复任务到内存再继续操作。
- **Electron**：`electron/src/orchestrator.js` 已改为「适配器」，内部委托 `core/orchestrator` 与 `core/id`，GUI 与 HTTP 使用同一套编排与状态。

### 从 SQLite 恢复任务

当 HTTP 服务重启或未曾在当前进程创建过某任务时，调用 `GET /api/tasks/:taskId`、`GET /api/tasks/:taskId/steps`、`POST .../steps/:stepName/run` 等会先根据 `taskId` 从 `work/database.sqlite` 加载任务与步骤状态到内存，再返回或执行，无需重新创建任务即可继续查询或重试某步。

---

## 十三、给维护者的注意事项

1. **分支规范**：任何开发都必须在 `feature/*` 或 `hotfix/*` 上进行，禁止直接在 `master` / `staging` 开发（见 `docs/GIT_FLOW.md`）。
2. **下载独立性**：不要引入「视频下载失败就终止后续步骤」的逻辑，始终保证至少能拿到 original.md + summary.md。
3. **复用机制**：新增逻辑时优先复用已有输出，注意与 `FORCE` 参数、SQLite 状态保持一致。
4. **FOCUS 重要性**：任何与 summary 相关的改动，都要考虑没有 FOCUS、补充 FOCUS 之后、重复运行等场景。
5. **契约文档**：修改流水线的状态字段或输出结构时，务必同步更新 `CLAUDE.md` 与本文件中对应章节。
6. **Agent Service**：修改 `core/orchestrator` 或 HTTP 路由时，注意保持与 Electron 适配器及 SQLite 持久化约定一致；新增 API 或字段时可在本节「Agent HTTP Service」中补充说明。

