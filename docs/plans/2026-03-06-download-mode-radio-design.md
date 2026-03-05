# 设计文档：弹窗下载选项改为单选控件

**日期**: 2026-03-06

## 概述
将弹窗中的"下载视频" checkbox 改为展开的单选项控件，提供三个选项："视频"、"音频"、"仅字幕"。

## UI/UX 改动

### 布局
- 替换 checkbox 为三个横向排列的方形单选按钮
- 默认选中"视频"（保持原有行为）

### 视觉样式
- 使用方形样式（复用现有 checkbox 的方形自定义样式）
- 选中状态：黑色填充 + 白色对勾
- 未选中状态：灰色边框 + 透明背景

## 数据模型

### 前端存储 (downloadVideo)
| 值 | 含义 |
|---|---|
| `'video'` | 下载视频 (MODE=full_flow_video) |
| `'audio'` | 下载音频 (MODE=full_flow_audio) |
| `'transcript'` | 仅转录 (MODE=full_flow_transcript) |

### 后端支持
main.js 已支持三种 MODE，无需修改。

## 代码改动

### 1. HTML (index.html)
- 替换 checkbox 为 radio 组
- 三个选项：视频、音频、仅字幕

### 2. CSS (index.html)
- 复用 `.checkbox-label` 样式用于 radio
- 新增 `.radio-label` 或复用现有类

### 3. JavaScript (index.html)
- 修改 `modalDownloading` 为字符串类型
- 修改读取/写入逻辑：`modalVideoToggle.checked` → `modalVideoToggle.value`
- 修改状态显示逻辑：根据 mode 显示对应步骤

## 任务列表
- [ ] 修改 HTML：checkbox 改为 radio 组
- [ ] 修改 CSS：支持 radio 样式
- [ ] 修改 JS：更新状态读写逻辑
- [ ] 测试：验证三种模式都能正常工作
