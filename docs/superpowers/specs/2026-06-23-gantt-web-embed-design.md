---
migrated: 2026-06-29
implemented_in:
  - web/src/routes/tasks.$id.gantt.tsx  # Gantt 独立路由，纯 React 实现
---

# Gantt Chart Web Embed 设计文档

## 概述

在 Web 端任务详情页右上角新增甘特图入口，点击跳转独立路由 `/tasks/:id/gantt`，以纯 React 实现渲染，复用现有 `/api/tasks/:id/steps` 数据，尽力渲染有时间戳的步骤，无数据时展示空状态说明。

## 背景

DAG 并行执行功能合并后，步骤级时间戳（`started_at` / `completed_at`）已写入 SQLite，并通过 `/api/tasks/:id/steps` 暴露。目前甘特图仅能通过 `node scripts/generate-gantt.js` 命令行生成静态 HTML，用户无法在 Web 端直接查看。

历史任务（时间戳精度迁移前执行）可能所有步骤 `started_at` 相同（等于任务创建时刻），导致无法区分先后——需要"尽力渲染"策略，有多少数据展示多少，完全无有效数据时才给空状态。

## 现有问题需一并修复

### `api.ts` 中 `Step` 接口与后端不匹配

**当前（错误）：**
```ts
export interface Step {
  name: string;
  status: TaskStatus;
  started_at?: number;    // 实际后端返回 ISO 字符串，不是 ms
  finished_at?: number;   // 后端字段名是 completed_at
  error_message?: string; // 后端字段名是 error
}
```

**修正后：**
```ts
export interface Step {
  name: string;
  status: TaskStatus;
  attempts: number;
  error: string | null;
  started_at: string | null;    // ISO 8601，组件内自行转 ms
  completed_at: string | null;
}
```

### `api.getSteps` 返回类型声明错误

后端 `ctx.body = steps`（直接数组），但 `api.ts` 声明为 `request<{ steps: Step[] }>`，导致 `useSteps` 里 `(await api.getSteps(id!)).steps` 取到 `undefined`。

**修正：** `api.getSteps` 改为 `request<Step[]>`，`useSteps` hook 里去掉 `.steps` 解构。

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/src/lib/api.ts` | 修改 | 修正 `Step` 接口 + `getSteps` 返回类型 |
| `web/src/hooks/use-tasks.ts` | 修改 | `useSteps` 去掉 `.steps` 解构 |
| `web/src/routes/tasks.$id.gantt.tsx` | 新建 | 甘特图页面路由组件 |
| `web/src/components/gantt-chart.tsx` | 新建 | 纯展示组件，接收 props 渲染图表 |
| `web/src/main.tsx` | 修改 | 注册新路由 |
| `web/src/routes/tasks.$id.tsx` | 修改 | 右上角加入口按钮 |

## 数据流

```
/tasks/:id/gantt 页面加载
  ├─ useTask(id)      → GET /api/tasks/:id      → { title, mode, created_at }
  └─ useSteps(id)     → GET /api/tasks/:id/steps → Step[]

computeGanttData(task, steps):
  1. 筛选有效步骤：started_at && completed_at && completed_at > started_at
  2. T0 = min(有效步骤的 started_at ms)；若无有效步骤 → T0 = task.created_at ms
  3. 计算每个步骤 { start: ms - T0, end: ms - T0, cat }
  4. totalMs = max(end)
  5. serialMs = Σ(end - start)
  6. speedup = serialMs / totalMs（保留一位小数）

若有效步骤数 = 0 → 渲染空状态组件
```

## 步骤分类映射

```ts
const STEP_CAT: Record<string, 'fetch' | 'download' | 'convert' | 'ai'> = {
  fetch:     'fetch',
  video:     'download',
  audio:     'download',
  subs:      'download',
  asr:       'convert',
  vtt2md:    'convert',
  md2vtt:    'convert',
  translate: 'ai',
  article:   'ai',
  summary:   'ai',
};
```

分类颜色（与现有 HTML 模板一致）：
- `fetch` → 蓝 `#60a5fa`
- `download` → 红橙 `#f87171`
- `convert` → 绿 `#4ade80`
- `ai` → 紫 `#c084fc`

## 组件设计

### `<GanttChart>` props

```ts
interface GanttStep {
  name: string;
  cat: 'fetch' | 'download' | 'convert' | 'ai';
  start: number;   // ms from T0
  end: number;     // ms from T0
}

interface GanttChartProps {
  totalMs: number;
  serialMs: number;
  steps: GanttStep[];
}
```

组件职责：
- 渲染时间标尺（tickInterval 自动适配 ms → 秒）
- 每行：`● name  <duration>  [═══════ bar ═══]`
- 条形宽度 = `(end - end) / totalMs * 100%`，左偏移 = `start / totalMs * 100%`
- 底部并发折线图（可选，若实现复杂度过高可留 v2）
- 统计卡片行：加速比、实际耗时、串行估计、节省时间、步骤数

### 页面 `tasks.$id.gantt.tsx` 结构

```
┌─ Header (h-12) ────────────────────────────────────────────┐
│  ← 返回详情   任务标题（截断）           [任务ID · mode · 日期] │
└──────────────────────────────────────────────────────────── ┘
┌─ 内容区（深色背景，全屏剩余高度）──────────────────────────────┐
│  加载中 / 空状态 / <GanttChart />                           │
└──────────────────────────────────────────────────────────── ┘
```

返回链接：`Link to={/tasks/${id}}`（回详情页，不是首页）。

### 空状态

有效步骤数 = 0 时显示：

```
📊
此任务暂无执行时间数据

步骤时间戳仅在 2026-06-23 之后执行的任务中记录。
重新触发任务执行后，甘特图将自动可用。
```

### 入口按钮（`tasks.$id.tsx`）

位置：header 右侧，`ModeSwitcher` 右边，现有 `⌘K` / `⋯` 左边。

```tsx
<Link
  to={`/tasks/${id}/gantt`}
  title="执行甘特图"
  className="text-sm px-2 py-1 rounded"
  style={{ color: 'var(--text-tertiary)' }}
>
  ▦
</Link>
```

按钮始终显示（不因数据缺失隐藏），点进去看到空状态解释。

## 时间格式辅助函数

```ts
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function parseIso(s: string | null): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}
```

## 路由注册

`main.tsx` 新增：

```tsx
import GanttPage from './routes/tasks.$id.gantt';

// 在 /tasks/:id 之后：
{ path: '/tasks/:id/gantt', element: <GanttPage /> }
```

## 测试策略

1. **`api.ts` 修复**：手动 curl `GET /api/tasks/:id/steps`，确认字段名与新接口一致
2. **`useSteps` 修复**：在详情页已有的步骤面板中验证数据正常（如有）
3. **新路由**：用已有真实任务 `034f49a37267` 验证甘特图渲染，确认 9 个步骤全部显示
4. **空状态**：构造无时间戳任务验证空状态文案
5. **入口按钮**：确认详情页右上角按钮可见，点击跳转正确 URL

## 不在本次范围内

- 并发折线图（底部 sparkline）——实现复杂，可 v2 单独加
- 多任务对比 / 多 scenario 标签切换（模板支持但本次单任务）
- 运行中任务实时刷新（本次只做静态快照）
