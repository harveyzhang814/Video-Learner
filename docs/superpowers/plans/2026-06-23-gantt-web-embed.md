# Gantt Chart Web Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 任务详情页右上角加入甘特图入口按钮，点击跳转 `/tasks/:id/gantt` 独立页面，用 React 渲染步骤并行执行时间线，尽力展示有时间戳的步骤，无数据时显示空状态。

**Architecture:** 修正 `api.ts` 中 `Step` 接口与后端实际返回的字段不匹配问题；新增纯展示组件 `<GanttChart>` 和页面路由 `tasks.$id.gantt.tsx`；在详情页 header 加 `▦` 链接按钮。数据来自已有的 `/api/tasks/:id/steps` 端点，不需要新 API。

**Tech Stack:** React 19, React Router v7, React Query, Tailwind CSS v4, TypeScript

## Global Constraints

- 所有文件路径使用 `@/` 前缀（alias to `src/`）
- 组件文件使用 `.tsx` 扩展名，纯逻辑文件使用 `.ts`
- CSS 颜色优先使用 `var(--xxx)` CSS 变量（定义见 `web/src/styles/globals.css`）；步骤分类颜色（蓝/红/绿/紫）固定值，不走 CSS 变量
- 禁止在 `staging` / `master` 直接开发；本功能在 `feature/gantt-web-embed` 分支上实现
- 合并到 `staging` 必须 `git merge --no-ff`
- 不引入新的 npm 依赖

---

### Task 1: 修复 `api.ts` Step 接口 + `useSteps` hook

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/hooks/use-tasks.ts`

**Interfaces:**
- Produces: 修正后的 `Step` 类型，供 Task 2、3 使用：
  ```ts
  export interface Step {
    name: string;
    status: TaskStatus;
    attempts: number;
    error: string | null;
    started_at: string | null;    // ISO 8601 字符串
    completed_at: string | null;
  }
  ```

- [ ] **Step 1: 在 `api.ts` 中替换 `Step` 接口**

  找到现有接口（约第 48-54 行）：
  ```ts
  export interface Step {
    name: string;
    status: TaskStatus;
    started_at?: number;
    finished_at?: number;
    error_message?: string;
  }
  ```
  替换为：
  ```ts
  export interface Step {
    name: string;
    status: TaskStatus;
    attempts: number;
    error: string | null;
    started_at: string | null;
    completed_at: string | null;
  }
  ```

- [ ] **Step 2: 在 `api.ts` 中修正 `getSteps` 返回类型**

  找到（约第 162 行）：
  ```ts
  getSteps:  (id: string) => request<{ steps: Step[] }>(`/api/tasks/${id}/steps`),
  ```
  替换为：
  ```ts
  getSteps:  (id: string) => request<Step[]>(`/api/tasks/${id}/steps`),
  ```

- [ ] **Step 3: 在 `use-tasks.ts` 中修正 `useSteps` hook**

  找到（约第 30-37 行）：
  ```ts
  export function useSteps(id: string | undefined) {
    return useQuery({
      queryKey: ['task', id, 'steps'],
      queryFn: async () => (await api.getSteps(id!)).steps,
      enabled: Boolean(id),
      staleTime: 10_000
    });
  }
  ```
  替换为：
  ```ts
  export function useSteps(id: string | undefined) {
    return useQuery({
      queryKey: ['task', id, 'steps'],
      queryFn: () => api.getSteps(id!),
      enabled: Boolean(id),
      staleTime: 10_000
    });
  }
  ```

- [ ] **Step 4: 检查 TypeScript 编译无报错**

  ```bash
  cd web && npx tsc --noEmit
  ```
  Expected: 无错误输出（或仅有与本次修改无关的既有警告）

- [ ] **Step 5: 验证 API 数据形状（需后端运行）**

  ```bash
  # 启动后端（若未运行）
  vdl web &
  sleep 3

  # 查询任一已完成任务的步骤（替换 <TASK_ID> 为实际 ID）
  curl -s http://127.0.0.1:3000/api/tasks/034f49a37267/steps | python3 -m json.tool | head -30
  ```

  Expected：返回一个 JSON 数组，每项含 `name`, `status`, `attempts`, `error`, `started_at`, `completed_at` 字段，例如：
  ```json
  [
    {
      "name": "fetch",
      "status": "completed",
      "attempts": 1,
      "error": null,
      "started_at": "2026-05-23T06:52:25.000",
      "completed_at": "2026-05-23T06:55:07.000"
    },
    ...
  ]
  ```

- [ ] **Step 6: Commit**

  ```bash
  git checkout -b feature/gantt-web-embed
  git add web/src/lib/api.ts web/src/hooks/use-tasks.ts
  git commit -m "fix: correct Step interface and useSteps return type to match backend"
  ```

---

### Task 2: 创建 `<GanttChart>` 纯展示组件

**Files:**
- Create: `web/src/components/gantt-chart.tsx`

**Interfaces:**
- Consumes: `Step`（来自 Task 1 修正后的 `@/lib/api`）
- Produces: `<GanttChart>` 组件，供 Task 3 的页面路由使用：
  ```ts
  interface GanttStep {
    name: string;
    cat: 'fetch' | 'download' | 'convert' | 'ai';
    startMs: number;   // 相对 T0 的毫秒偏移
    endMs: number;
  }

  interface GanttChartProps {
    totalMs: number;
    serialMs: number;
    steps: GanttStep[];   // 只传有效步骤（startMs < endMs）
  }

  export function GanttChart(props: GanttChartProps): JSX.Element
  ```

- [ ] **Step 1: 创建 `gantt-chart.tsx`，写入完整实现**

  创建 `web/src/components/gantt-chart.tsx`，内容如下：

  ```tsx
  import type { JSX } from 'react';

  export interface GanttStep {
    name: string;
    cat: 'fetch' | 'download' | 'convert' | 'ai';
    startMs: number;
    endMs: number;
  }

  interface GanttChartProps {
    totalMs: number;
    serialMs: number;
    steps: GanttStep[];
  }

  const CAT_COLOR: Record<GanttStep['cat'], string> = {
    fetch:    '#60a5fa',
    download: '#f87171',
    convert:  '#4ade80',
    ai:       '#c084fc',
  };

  const CAT_LABEL: Record<GanttStep['cat'], string> = {
    fetch:    '元数据',
    download: '下载',
    convert:  '转换',
    ai:       'AI 生成',
  };

  function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 1000)}s`;
  }

  function tickInterval(totalMs: number): number {
    const targets = [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000];
    const target = totalMs / 6;
    return targets.find(t => t >= target) ?? targets[targets.length - 1];
  }

  export function GanttChart({ totalMs, serialMs, steps }: GanttChartProps): JSX.Element {
    const speedup = serialMs > 0 ? (serialMs / totalMs).toFixed(1) : '—';
    const saved = serialMs - totalMs;
    const interval = tickInterval(totalMs);
    const ticks = Array.from(
      { length: Math.floor(totalMs / interval) + 1 },
      (_, i) => i * interval
    );

    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '24px 0' }}>
        {/* Stats row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 1,
          marginBottom: 24,
          background: 'var(--border-subtle)',
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          {[
            { label: '加速比', value: `${speedup}×`, accent: true },
            { label: '实际耗时', value: fmtMs(totalMs) },
            { label: '串行估计', value: fmtMs(serialMs) },
            { label: '节省时间', value: fmtMs(Math.max(0, saved)), accent: saved > 0 },
            { label: '步骤数', value: String(steps.length) },
          ].map(({ label, value, accent }) => (
            <div key={label} style={{
              background: 'var(--bg-surface)',
              padding: '12px 16px',
            }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
              <div style={{
                fontSize: 20,
                fontWeight: 600,
                color: accent ? '#4ade80' : 'var(--text-primary)',
              }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Chart area */}
        <div style={{ position: 'relative' }}>
          {/* Ruler */}
          <div style={{
            display: 'flex',
            marginLeft: 120,
            marginBottom: 4,
            position: 'relative',
            height: 16,
          }}>
            {ticks.map(t => (
              <div key={t} style={{
                position: 'absolute',
                left: `${(t / totalMs) * 100}%`,
                color: 'var(--text-tertiary)',
                fontSize: 10,
                transform: 'translateX(-50%)',
              }}>
                {fmtMs(t)}
              </div>
            ))}
          </div>

          {/* Grid lines */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, left: 120, pointerEvents: 'none' }}>
              {ticks.map(t => (
                <div key={t} style={{
                  position: 'absolute',
                  left: `${(t / totalMs) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: 'var(--border-subtle)',
                }} />
              ))}
            </div>

            {/* Step rows */}
            {steps.map(s => {
              const left = (s.startMs / totalMs) * 100;
              const width = ((s.endMs - s.startMs) / totalMs) * 100;
              const color = CAT_COLOR[s.cat];
              return (
                <div key={s.name} style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 32,
                  marginBottom: 2,
                }}>
                  {/* Label */}
                  <div style={{
                    width: 120,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    paddingRight: 8,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: color, flexShrink: 0,
                    }} />
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                  </div>
                  {/* Bar area */}
                  <div style={{ flex: 1, position: 'relative', height: 20 }}>
                    <div style={{
                      position: 'absolute',
                      left: `${left}%`,
                      width: `${Math.max(width, 0.5)}%`,
                      height: '100%',
                      background: color,
                      opacity: 0.85,
                      borderRadius: 3,
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 6,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      boxSizing: 'border-box',
                    }}>
                      <span style={{ color: '#000', fontSize: 10, opacity: 0.75 }}>
                        {fmtMs(s.endMs - s.startMs)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          gap: 16,
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {(Object.keys(CAT_COLOR) as GanttStep['cat'][]).map(cat => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: CAT_COLOR[cat], flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text-tertiary)' }}>{CAT_LABEL[cat]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: 检查 TypeScript 编译**

  ```bash
  cd web && npx tsc --noEmit
  ```
  Expected: 无新增错误

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/components/gantt-chart.tsx
  git commit -m "feat: add GanttChart presentational component"
  ```

---

### Task 3: 创建甘特图页面路由

**Files:**
- Create: `web/src/routes/tasks.$id.gantt.tsx`

**Interfaces:**
- Consumes:
  - `useTask(id)` → `Task`（来自 `@/hooks/use-tasks`）
  - `useSteps(id)` → `Step[]`（Task 1 修正后）
  - `GanttChart`, `GanttStep`（来自 Task 2）
- Produces: 默认导出 `GanttPage` 组件，注册到 `/tasks/:id/gantt` 路由（Task 4）

步骤分类映射（在此文件内定义，不导出）：
```ts
const STEP_CAT: Record<string, GanttStep['cat']> = {
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

- [ ] **Step 1: 创建页面路由文件**

  创建 `web/src/routes/tasks.$id.gantt.tsx`：

  ```tsx
  import { useParams, Link } from 'react-router';
  import { useTask, useSteps } from '@/hooks/use-tasks';
  import { GanttChart, type GanttStep } from '@/components/gantt-chart';
  import type { Step } from '@/lib/api';

  const STEP_CAT: Record<string, GanttStep['cat']> = {
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

  function parseIso(s: string | null): number | null {
    if (!s) return null;
    const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
    return Number.isFinite(ms) ? ms : null;
  }

  function computeGanttData(steps: Step[], taskCreatedAt: number): {
    ganttSteps: GanttStep[];
    totalMs: number;
    serialMs: number;
  } {
    const valid = steps
      .map(s => ({
        name: s.name,
        cat: (STEP_CAT[s.name] ?? 'convert') as GanttStep['cat'],
        startMs: parseIso(s.started_at),
        endMs: parseIso(s.completed_at),
      }))
      .filter((s): s is { name: string; cat: GanttStep['cat']; startMs: number; endMs: number } =>
        s.startMs !== null && s.endMs !== null && s.endMs > s.startMs
      );

    if (valid.length === 0) {
      return { ganttSteps: [], totalMs: 0, serialMs: 0 };
    }

    const t0 = Math.min(...valid.map(s => s.startMs), taskCreatedAt);
    const ganttSteps: GanttStep[] = valid
      .map(s => ({
        name: s.name,
        cat: s.cat,
        startMs: s.startMs - t0,
        endMs: s.endMs - t0,
      }))
      .sort((a, b) => a.startMs - b.startMs);

    const totalMs = Math.max(...ganttSteps.map(s => s.endMs));
    const serialMs = ganttSteps.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
    return { ganttSteps, totalMs, serialMs };
  }

  export default function GanttPage() {
    const { id = '' } = useParams();
    const { data: task, isLoading: taskLoading } = useTask(id);
    const { data: steps, isLoading: stepsLoading } = useSteps(id);

    const isLoading = taskLoading || stepsLoading;

    const { ganttSteps, totalMs, serialMs } = task && steps
      ? computeGanttData(steps, task.created_at)
      : { ganttSteps: [], totalMs: 0, serialMs: 0 };

    return (
      <div className="h-screen flex flex-col">
        {/* Header */}
        <header
          className="h-12 flex items-center justify-between px-5 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-4 min-w-0">
            <Link
              to={`/tasks/${id}`}
              className="text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ←
            </Link>
            <h1
              className="chinese text-sm font-medium truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {task?.title || task?.url || id}
            </h1>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {id} · mode={task?.mode ?? '…'}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</p>
          )}

          {!isLoading && ganttSteps.length === 0 && (
            <div
              className="flex flex-col items-center justify-center h-64 gap-3"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <span style={{ fontSize: 32 }}>📊</span>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                此任务暂无执行时间数据
              </p>
              <p className="text-xs text-center" style={{ maxWidth: 320 }}>
                步骤时间戳仅在 2026-06-23 之后执行的任务中记录。
                重新触发任务执行后，甘特图将自动可用。
              </p>
            </div>
          )}

          {!isLoading && ganttSteps.length > 0 && (
            <GanttChart
              totalMs={totalMs}
              serialMs={serialMs}
              steps={ganttSteps}
            />
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: 检查 TypeScript 编译**

  ```bash
  cd web && npx tsc --noEmit
  ```
  Expected: 无新增错误

- [ ] **Step 3: Commit**

  ```bash
  git add "web/src/routes/tasks.\$id.gantt.tsx"
  git commit -m "feat: add GanttPage route for /tasks/:id/gantt"
  ```

---

### Task 4: 注册路由 + 添加入口按钮

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `web/src/routes/tasks.$id.tsx`

**Interfaces:**
- Consumes: `GanttPage`（Task 3 的默认导出）

- [ ] **Step 1: 在 `main.tsx` 注册新路由**

  找到（约第 10-11 行）：
  ```tsx
  import RootLayout from './routes/_layout';
  import Home from './routes/_index';
  import TaskDetail from './routes/tasks.$id';
  ```
  改为：
  ```tsx
  import RootLayout from './routes/_layout';
  import Home from './routes/_index';
  import TaskDetail from './routes/tasks.$id';
  import GanttPage from './routes/tasks.$id.gantt';
  ```

  找到 router children 数组（约第 19-24 行）：
  ```tsx
  children: [
    { path: '/', element: <Home /> },
    { path: '/tasks/:id', element: <TaskDetail /> }
  ]
  ```
  改为：
  ```tsx
  children: [
    { path: '/', element: <Home /> },
    { path: '/tasks/:id', element: <TaskDetail /> },
    { path: '/tasks/:id/gantt', element: <GanttPage /> }
  ]
  ```

- [ ] **Step 2: 在 `tasks.$id.tsx` header 添加 `▦` 入口按钮**

  找到（约第 70-78 行）：
  ```tsx
  <div className="flex items-center gap-3">
    <ModeSwitcher />
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
      <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
      <button>⋯</button>
    </div>
  </div>
  ```
  改为（在 `ModeSwitcher` 和现有 `div` 之间插入 Link）：
  ```tsx
  <div className="flex items-center gap-3">
    <ModeSwitcher />
    <Link
      to={`/tasks/${id}/gantt`}
      title="执行甘特图"
      className="text-sm px-2 py-1 rounded hover:opacity-70 transition-opacity"
      style={{ color: 'var(--text-tertiary)' }}
    >
      ▦
    </Link>
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
      <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
      <button>⋯</button>
    </div>
  </div>
  ```

  注意：`tasks.$id.tsx` 顶部已有 `import { useParams, Link } from 'react-router';`，无需重复导入。

- [ ] **Step 3: 检查 TypeScript 编译**

  ```bash
  cd web && npx tsc --noEmit
  ```
  Expected: 无新增错误

- [ ] **Step 4: 启动开发服务器验证**

  ```bash
  vdl web
  # 在浏览器访问 http://localhost:5173
  ```

  验证以下内容：
  1. 任意任务详情页 → 右上角 `ModeSwitcher` 旁边出现 `▦` 按钮
  2. 点击 `▦` → URL 变为 `/tasks/:id/gantt`，页面正常加载
  3. 有时间戳的任务（如 `034f49a37267`）→ 显示甘特图，统计行、时间标尺、步骤条形、图例全部可见
  4. 甘特图页面左上角 `←` → 回到 `/tasks/:id` 详情页（不是首页）
  5. 无有效时间戳的任务 → 显示空状态文案

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/main.tsx "web/src/routes/tasks.\$id.tsx"
  git commit -m "feat: register /tasks/:id/gantt route and add entry button to task detail header"
  ```
