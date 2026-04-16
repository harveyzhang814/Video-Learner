# Orchestrator 重构设计

## 目标

将单体 bash 脚本拆分为独立的步骤脚本 + Node.js 编排层，使前端能够精细控制每个子任务。

## 架构

```
Electron Main.js → Orchestrator.js → 独立步骤脚本
```

## 步骤脚本

| # | 步骤 | 脚本 | 输入 | 输出 |
|---|------|------|------|------|
| 1 | 视频下载 | `download_video.sh <url> <dir>` | url, 目录 | video.mp4 |
| 2 | 音频提取 | `download_audio.sh <url> <dir>` | url, 目录 | audio.m4a |
| 3 | 字幕下载 | `download_subs.sh <url> <dir>` | url, 目录 | subs/*.vtt |
| 4 | VTT→MD | `convert_vtt_md.sh <vtt> <md>` | VTT 文件 | original_en.md, original_zh.md |
| 5 | MD→VTT | `convert_md_vtt.sh <md> <vtt>` | MD 文件 | original_*.vtt |
| 6 | 文章生成 | `generate_article.sh <transcript> <output>` | 逐字稿 | article.md |
| 7 | 总结生成 | `generate_summary.sh <article> <focus> <output>` | 文章+FOCUS | summary.md |

## 编排层 API

```javascript
// 1. 全部执行
orchestrator.run(url, { downloadVideo: true, focus: '...' })

// 2. 单步执行
orchestrator.runStep(id, 'video')
orchestrator.runStep(id, 'transcript')
orchestrator.runStep(id, 'article')
orchestrator.runStep(id, 'summary')

// 3. 步骤重试
orchestrator.retryStep(id, 'stepName')

// 4. 跳过步骤
orchestrator.skipStep(id, 'stepName')

// 5. 查看进度
orchestrator.getStatus(id)
```

## 前置条件检查

每个步骤执行前检查所需文件和参数是否存在，不满足则报错返回。

## 状态存储

使用现有 `meta.json`，新增字段：

```json
{
  "current_step": "video|audio|transcript|article|summary|complete",
  "step_status": "pending|running|completed|failed|skipped",
  "steps": {
    "video": { "status": "completed", "attempts": 1, "error": null },
    "audio": { "status": "skipped", "attempts": 0, "error": null },
    ...
  }
}
```

## 兼容性

- 保留现有 `run.sh` 作为便捷入口（内部调用编排层）
- 现有 `meta.json` 字段继续有效
