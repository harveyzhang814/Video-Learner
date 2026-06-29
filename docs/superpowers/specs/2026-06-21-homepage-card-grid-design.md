---
migrated: 2026-06-29
implemented_in:
  - web/src/routes/index.tsx  # 首页卡片 Grid 布局与实时搜索框
---

# 首页卡片 Grid + 搜索 设计文档

## 概述

将首页任务列表从线性行列表重构为 3 列卡片 Grid，并在 Header 中内嵌实时搜索框替代现有的状态筛选标签页（FilterBar）。

## 背景

当前首页使用 `TaskRow` 线性列表，信息密度低，视觉缺乏层次感。用户需要快速定位历史任务，但没有搜索能力。`FilterBar` 的状态筛选不再需要保留。

## 用户故事

- 打开首页，看到卡片 Grid，可快速浏览所有任务
- 在 Header 搜索框输入关键词，卡片实时过滤（匹配 title / url）
- 按 `Escape` 清空搜索，恢复全部卡片

## 架构设计

### 组件变更

| 组件 | 变更 |
|------|------|
| `web/src/routes/_index.tsx` | 新增 `searchQuery` state；移除 FilterBar；改用 TaskCard Grid |
| `web/src/components/task-card.tsx` | 新建，替代 TaskRow |
| `web/src/components/task-row.tsx` | 保留文件，不再被首页引用 |
| `web/src/components/filter-bar.tsx` | 保留文件，不再被首页引用 |

### 搜索逻辑

客户端实时过滤，无网络请求：

```ts
const filtered = tasks.filter((t) => {
  const q = searchQuery.toLowerCase();
  if (!q) return true;
  return (t.title ?? '').toLowerCase().includes(q)
      || t.url.toLowerCase().includes(q);
});
```

## 布局

### 页面容器

```
max-w-6xl mx-auto px-8 pt-16 pb-24
```

### Header

```
左：h1 "Video Learner"
右：<input placeholder="搜索…" />  +  ⌘K 快捷键提示（右侧）
```

- `⌘K` 全局快捷键聚焦搜索框（复用现有 `useGlobalHotkeys` 或在 `_index.tsx` 内绑定）
- `Escape` 清空 query 并失焦

### Grid

```css
grid grid-cols-3 gap-4
/* 响应式：sm:grid-cols-2 */
```

### 卡片结构

```
┌─────────────────────────────┐
│ 标题（最多2行，超出省略）        │
│                             │
│ youtube.com/watch?v=xxx…    │  ← URL 单行截断，text-tertiary
│                             │
│ media · 1080p · 32:15  3h前 │  ← 元信息 + 时间右对齐
└─────────────────────────────┘
```

- 背景：`var(--bg-surface)`
- 圆角：`rounded-xl`
- 描边：`border`，颜色 `var(--border-subtle)`
- Hover：背景略亮（`var(--bg-elevated)`）
- Padding：`p-4`

### 元信息行

```ts
const meta = [task.mode, resolution, duration].filter(Boolean).join(' · ');
```

元信息左对齐，时间右对齐，同一行 flex justify-between。

### Failed 状态

- 标题颜色：`var(--text-secondary)`
- 元信息行替换为错误信息（`var(--status-err)`，单行截断）

### 空状态

- 无任务：`暂无任务 / 新建：vdl <URL>`（居中）
- 搜索无结果：`无匹配结果`（居中）

## 数据流

```
useTasks() → tasks[]
    ↓ searchQuery filter (client-side)
filtered[]
    ↓ map
<TaskCard />
```

## 测试策略

手动验证：
1. 3 列 Grid 正确渲染
2. 搜索框实时过滤 title/URL
3. Escape 清空搜索
4. Failed 任务显示红色错误信息
5. 空任务 / 无匹配 各自空状态正确
