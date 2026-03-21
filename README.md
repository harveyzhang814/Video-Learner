# Video-Learner

YouTube 视频处理流水线 - 下载、转录、总结，一站式完成。

## 功能特性

- **视频下载**: 自动下载最高 1080p 视频和音频
- **双语字幕**: 自动获取中英双语字幕，优先使用原创字幕
- **繁体兜底**: 仅当英文与简体中文都未成功下载到任何字幕（original 或 auto）时，才会尝试繁体字幕（`zh-TW`/`zh-Hant`；original 优先，其次 auto）
- **智能转录**: 转换为带时间戳的逐字稿，自动去重
- **文章整理**: 将转录整理为结构化文章
- **重点总结**: 根据你关注的重点生成精准摘要
- **桌面客户端**: 提供 Electron GUI，支持视频播放和字幕同步

## 快速开始

### 首次安装

```bash
# 自动安装所有依赖（推荐）
bash scripts/install.sh

# 或者直接启动（会自动检查并安装依赖）
bash start-electron.sh
```

### Agent Service（HTTP 编排）

一键 shell 入口 `scripts/run.sh` **已废弃**（执行将报错并提示替代方式）。请使用本地 HTTP 服务创建任务：

```bash
# 启动 Agent Service（默认端口见终端输出，可用 PORT= 覆盖）
npm run agent:serve
```

在另一终端使用 `POST /api/tasks` 创建任务（`url`、`focus`、`mode`、`force` 等），或配合外部 agent 调用。字段语义与下面「参数说明」对应；完整约定见 [docs/PROJECT_KNOWLEDGE.md](docs/PROJECT_KNOWLEDGE.md) 中「Agent HTTP Service」一节。

端到端校验（与上述编排一致、较慢）：

```bash
npm run test:agent:e2e
# 或: bash scripts/test_full_e2e.sh
```

### GUI 使用

```bash
# 启动桌面客户端
bash start-electron.sh
```

## 参数说明

创建任务时（GUI 表单或 `POST /api/tasks`）常用字段如下：

| 字段 / 概念 | 说明 | 典型默认 |
|-------------|------|----------|
| `url` | YouTube 视频链接 | 必填 |
| `mode` | `both` / `video` / `audio` / `transcript` | 视 UI 而定 |
| `force` | 是否强制重跑对应步骤 | `false` |
| `focus` | 总结侧重点 | 可选 |
| `output_lang` | 输出语言（如 `zh-CN`） | `zh-CN` |

## 输出结构

```
work/
├── index.jsonl                    # 运行记录
└── <id>/
    ├── media/                     # 媒体文件
    │   ├── video.mp4             # 视频
    │   └── audio.m4a             # 音频
    ├── transcript/               # 转录与字幕
    │   ├── original.md           # 逐字稿
    │   └── meta.json             # 元数据
    └── writing/                  # 生成内容
        ├── article.md             # 结构化文章
        └── summary.md             # 重点总结
```

## 总结模板

生成的 summary.md 包含：

- **TL;DR**: 一句话总结
- **Outline**: 主要章节
- **Key Points**: 关键要点（含时间戳）
- **Action Items**: 行动项
- **Terms/Entities**: 关键术语

## 示例

- 启动 **GUI**，在界面中粘贴 URL，填写「关注重点」，选择是否下载视频/音频后创建任务。
- 或使用 **Agent Service**：`npm run agent:serve` 后按 `docs/PROJECT_KNOWLEDGE.md` 中的 HTTP 示例创建任务并轮询状态。

## 注意事项

- 视频下载失败不会阻断转录和总结流程
- 相同 URL 第二次运行会跳过已完成步骤
- 提供 FOCUS 可以获得更精准的总结
- 视频下载在后台独立运行，不影响其他步骤

## License

MIT
