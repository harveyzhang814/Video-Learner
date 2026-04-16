# MODE 设计方案

## 背景

原有 MODE 设计存在冗余（video/audio 模式无实际意义），且未区分全流程与独立环节。用户需要更清晰的设计来支持：
1. 全链路流程：选择视频载体或音频载体
2. 独立环节重试：某个步骤失败时单独重试

## 设计方案

### 全流程 MODE（带 `full_flow_` 前缀）

| MODE 名称 | 视频 | 音频 | 转录 | 文章 | 总结 |
|-----------|------|------|------|------|------|
| `full_flow_video` | ✅ | ❌ | ✅ | ✅ | ✅ |
| `full_flow_audio` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `full_flow_transcript` | ❌ | ❌ | ✅ | ✅ | ✅ |

**说明**：
- `full_flow_video`：下载视频作为播放载体，同时处理转录+文章+总结
- `full_flow_audio`：下载音频作为播放载体，同时处理转录+文章+总结
- `full_flow_transcript`：不下载媒体，只处理转录+文章+总结

### 独立环节重试 MODE

| MODE 名称 | 视频 | 音频 | 转录 | 文章 | 总结 |
|-----------|------|------|------|------|------|
| `download_video` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `download_audio` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `get_transcript` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `write_article` | ❌ | ❌ | ❌ | ✅ | ❌ |
| `summarize` | ❌ | ❌ | ❌ | ❌ | ✅ |

**说明**：用于某个步骤失败时单独重试，不影响其他步骤。

### 辅助函数设计

```bash
mode_has_video()      { echo "$MODE" | grep -qE "^(full_flow_video|download_video)$"; }
mode_has_audio()      { echo "$MODE" | grep -qE "^(full_flow_audio|download_audio)$"; }
mode_has_transcript() { [[ "$MODE" == "get_transcript" ]] || echo "$MODE" | grep -qE "^full_flow_"; }
mode_has_article()    { [[ "$MODE" == "write_article" ]] || [[ "$MODE" == full_flow_* ]] && ! [[ "$MODE" == "full_flow_transcript" ]] || [[ "$MODE" == "summarize" ]]; }
mode_has_summary()    { [[ "$MODE" == "summarize" ]] || echo "$MODE" | grep -qE "^full_flow_" | grep -v "transcript"; }
```

### 前端映射

| 前端选项 | MODE |
|---------|------|
| 下载视频 | `full_flow_video` |
| 下载音频 | `full_flow_audio` |
| 不下载媒体 | `full_flow_transcript` |

## 修改文件

1. `scripts/run.sh` - 修改 MODE 解析和辅助函数
2. `electron/src/main.js` - 修改前端到 MODE 的映射
3. `electron/src/renderer/index.html` - 修改前端 UI（可选单选按钮）

## 验证

1. 测试 `full_flow_video`：应下载 video.mp4 + 转录 + 文章 + 总结，无 audio.m4a
2. 测试 `full_flow_audio`：应下载 audio.m4a + 转录 + 文章 + 总结
3. 测试 `full_flow_transcript`：仅转录+文章+总结，无媒体文件
4. 测试独立环节 MODE：只执行对应步骤
