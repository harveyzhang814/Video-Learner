# Frontend Status Pills 与 Orchestrator Steps 对齐设计

## 目标

将前端状态 tag pills 与 Orchestrator 的 8 个 Steps 完全对齐，实现状态同步。

## Orchestrator 8 Steps

| Step | 脚本 | 说明 |
|------|------|------|
| fetch | fetch_info.sh | 获取视频元信息 |
| video | download_video.sh | 视频下载 |
| audio | download_audio.sh | 音频下载 |
| subs | download_subs.sh | 字幕下载 |
| vtt2md | convert_vtt_md.sh | VTT 转 Markdown |
| md2vtt | convert_md_vtt.sh | Markdown 转 VTT |
| article | generate_article.sh | 生成文章 |
| summary | generate_summary.sh | 提炼总结 |

## 前端标签文案

| Step | 标签 |
|------|------|
| fetch | 获取信息 |
| video | 视频下载 |
| audio | 音频下载 |
| subs | 字幕下载 |
| vtt2md | 转换文案 |
| md2vtt | 转寒字幕 |
| article | 文章生产 |
| summary | 提炼总结 |

## 修改文件

`electron/src/renderer/index.html`

### 修改点清单

1. **infoStatus pills (行 1284-1301)**
   - 替换为 8 个 status-pill

2. **progressSteps (行 1322-1329)**
   - 替换为 8 个 progress-step

3. **modal-status pills (行 1419-1441)**
   - 替换为 8 个 status-pill

4. **STEPS 数组 (行 1537)**
   ```javascript
   const STEPS = ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'];
   ```

5. **状态解析 parseProgress (行 2154-2209)**
   - 添加 subs_start, subs_done
   - 添加 vtt2md_start, vtt2md_done
   - 添加 md2vtt_start, md2vtt_done

6. **显示/隐藏逻辑 (行 1670-1696)**
   - 更新为 8 个 pills 的显示规则

## UI 展示

```
获取信息 → 视频下载 → 音频下载 → 字幕下载 → 转换文案 → 转寒字幕 → 文章生产 → 提炼总结
○         ○          ○         ○          ○          ○          ○          ○
```

- ○ 等待
- ◐ 进行中
- ● 完成
- ✕ 错误

## 状态同步

前端通过解析 Orchestrator 推送的事件更新 pills 状态：
- `task:status` 事件包含 `currentStep` 和 `stepStatus`
- `stepStatus`: running, completed, failed
