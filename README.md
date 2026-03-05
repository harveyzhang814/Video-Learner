# Video-Learner

YouTube 视频处理流水线 - 下载、转录、总结，一站式完成。

## 功能特性

- **视频下载**: 自动下载最高 1080p 视频和音频
- **双语字幕**: 自动获取中英双语字幕，优先使用原创字幕
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

### 命令行使用

```bash
# 基本用法
bash scripts/run.sh "https://www.youtube.com/watch?v=..."

# 指定关注重点
bash scripts/run.sh "https://youtube.com/..." FOCUS="技术细节,架构分析"

# 仅转录（不下载视频，节省空间）
bash scripts/run.sh "https://youtube.com/..." MODE=transcript

# 强制重新生成
bash scripts/run.sh "https://youtube.com/..." FORCE=1
```

### GUI 使用

```bash
# 启动桌面客户端
bash start-electron.sh
```

## 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `URL` | YouTube 视频链接 | (必填) |
| `LANG` | 语言代码 | `auto` |
| `MODE` | `both` / `video` / `audio` / `transcript` | `both` |
| `FORCE` | `0` 跳过已完成的 / `1` 强制重新执行 | `0` |
| `FOCUS` | 你想了解的重点 | (可选) |

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

```bash
# 处理一个技术视频
bash scripts/run.sh "https://www.youtube.com/watch?v=C5Cjvpfzc_0" FOCUS="技术细节,架构设计"

# 处理一个教程视频
bash scripts/run.sh "https://www.youtube.com/watch?v=..." FOCUS="步骤详解,关键技巧"
```

## 注意事项

- 视频下载失败不会阻断转录和总结流程
- 相同 URL 第二次运行会跳过已完成步骤
- 提供 FOCUS 可以获得更精准的总结
- 视频下载在后台独立运行，不影响其他步骤

## License

MIT
