# 弹窗状态感知与重置功能设计方案

## 背景

用户需要优化弹窗中的各步骤状态感知：
1. 状态持久化：一旦通过就保留状态，而不是每次都重新感知
2. 允许重置：某些情况下可以重置某个任务的状态

## 数据存储决策标准

基于以下标准决定数据存储位置：

| 标准 | 存 localStorage | 存后端 meta.json |
|------|----------------|------------------|
| 数据来源 | 用户输入偏好 | 系统执行结果 |
| 生命周期 | 临时/会话级 | 持久/任务级 |
| 共享需求 | 单设备 | 需跨设备 |

## 方案设计

### 1. localStorage 存储

| Key | 内容 | 用途 |
|-----|------|------|
learner_preferences| `video_` | `{ defaultFocus, defaultDownloadMode }` | 用户偏好，新建任务时自动填充 |
| `video_learner_task_<id>` | `{ download_status, transcript_done, article_done, summary_done, ... }` | 任务状态缓存 |

### 2. 状态感知流程

**当前问题**：每次打开弹窗都重新从后端读取状态

**优化后**：
1. 弹窗打开时优先读取 localStorage 缓存，显示"上次状态"
2. 后台异步校验后端实际状态
3. 如有差异则更新 UI

### 3. 重置功能

**交互方式**：
1. 点击已完成步骤的 **tag pill**（状态标签）
2. 弹出小弹窗，显示：
   - 步骤名称和当前状态
   - "重置此步骤" 按钮
   - "关闭" 按钮
3. 点击"重置"后：
   - 调用后端 API 更新 meta.json，将该步骤状态设为 `false`
   - UI 状态回退到"待处理"

**条件限制**：
- **仅已完成步骤可重置**：未完成或进行中的步骤不可点击

### 步骤映射

| Tag Pill | meta.json 字段 |
|----------|----------------|
| Video | `download_status` (设为 `pending`) |
| Audio | 无独立状态（复用 video） |
| Transcript | `transcript_done = false` |
| Article | `article_done = false` |
| Summary | `summary_done = false` |

## 修改文件

1. `electron/src/renderer/index.html` - 添加 localStorage 读写逻辑、tag pill 点击事件、重置弹窗 UI
2. `electron/src/main.js` - 添加重置状态的 IPC 处理器

## 验证

1. 打开任务弹窗，验证状态从 localStorage 快速加载
2. 点击已完成步骤的 tag pill，验证弹出重置弹窗
3. 点击"重置"，验证 meta.json 更新且 UI 回退
4. 验证未完成步骤的 tag pill 不可点击
