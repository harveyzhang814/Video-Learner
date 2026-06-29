# Prose Theme Academic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有双文件主题体系上新增 `academic` 主题（衬线字体 + 冷蓝石板配色），用户可通过 ProseThemePicker 在「默认」和「学术」之间即时切换。

**Architecture:** 向 `themes.css` 追加 academic 变量块及其深色覆盖块，同时在 `default` 块补 `--prose-font-family`；在 `globals.css` 的 `.prose-cn` 加 `font-family` 消费；在 `index.html` 加字体加载；在 `themes.ts` 注册表加一行，TypeScript 类型自动扩展。无需改动 Picker、store、layout 任何逻辑。

**Tech Stack:** CSS 自定义属性，TypeScript `as const`，Google Fonts（Source Serif 4），Vitest

## Global Constraints

- 不引入新 npm 包
- 不改动 `.prose-cn` 元素布局、间距、hljs 等非变量样式
- `ThemeId` 由 `typeof THEMES[number]['id']` 派生，禁止手写字符串联合
- 全部现有测试（18 个）必须继续通过；`tsc --noEmit` 0 errors
- 分支：`feature/prose-theme-academic`；提交使用 `--no-ff` 合并规范（合并时，非开发提交）
- 颜色值使用设计文档中精确的十六进制（见下文各任务步骤）

---

## File Map

| 文件 | 操作 | 内容 |
|------|------|------|
| `web/src/styles/themes.css` | 修改 | `default` 块补 `--prose-font-family`；追加 `academic` 块 + 深色覆盖 |
| `web/src/styles/globals.css` | 修改 | `.prose-cn` 第 54–58 行加 `font-family` |
| `web/index.html` | 修改 | `<head>` 加 Source Serif 4 字体 link |
| `web/src/lib/themes.ts` | 修改 | `THEMES` 加 `{ id: 'academic', label: '学术' }` |
| `web/src/stores/ui-store.test.ts` | 修改 | setter 测试改用 `'academic'` 验证真实 round-trip |

---

## Task 1: CSS 变量 + 字体加载

**Files:**
- Modify: `web/src/styles/themes.css`
- Modify: `web/src/styles/globals.css:54-58`
- Modify: `web/index.html`

**Interfaces:**
- Consumes: 无（纯 CSS，独立于 TS 层）
- Produces: `data-prose-theme="academic"` 属性存在时，CSS 变量从 themes.css 正确解析；`.prose-cn` 消费 `--prose-font-family`；Source Serif 4 字体可用

- [ ] **Step 1: 更新 `web/src/styles/themes.css`**

将文件完整替换为以下内容：

```css
/* ── Theme: default ── */
:root[data-prose-theme="default"] {
  --prose-font-family:  var(--font-sans);
  --prose-font-size:    15px;
  --prose-line-height:  1.85;
  --prose-max-width:    72ch;

  --prose-h1-size:  26px;
  --prose-h2-size:  20px;
  --prose-h3-size:  15.5px;
  --prose-h4-size:  14px;
  --prose-h5-size:  13px;
  --prose-h6-size:  12.5px;

  --prose-code-bg:      var(--accent-3);
  --prose-code-color:   var(--accent-11);
  --prose-pre-bg:       var(--bg-elevated);
  --prose-pre-border:   var(--border-subtle);

  --prose-link-color:        var(--accent-10);
  --prose-link-hover:        var(--accent-9);
  --prose-blockquote-border: var(--accent-9);
}

/* ── Theme: academic ── */
:root[data-prose-theme="academic"] {
  --prose-font-family:  'Source Serif 4', Georgia, 'Times New Roman', serif;
  --prose-font-size:    16px;
  --prose-line-height:  1.9;
  --prose-max-width:    68ch;

  --prose-h1-size:  28px;
  --prose-h2-size:  22px;
  --prose-h3-size:  16.5px;
  --prose-h4-size:  15px;
  --prose-h5-size:  13.5px;
  --prose-h6-size:  13px;

  --prose-code-bg:      #EEF2F8;
  --prose-code-color:   #2D4A7A;
  --prose-pre-bg:       #F4F6FB;
  --prose-pre-border:   #C8D3E8;

  --prose-link-color:        #3B6CB0;
  --prose-link-hover:        #2A5190;
  --prose-blockquote-border: #5A7FB5;
}

@media (prefers-color-scheme: dark) {
  :root[data-prose-theme="academic"] {
    --prose-code-bg:      #1E2A3E;
    --prose-code-color:   #8BAFD4;
    --prose-pre-bg:       #1A2438;
    --prose-pre-border:   #2E4068;

    --prose-link-color:        #7BA7E0;
    --prose-link-hover:        #91B8E8;
    --prose-blockquote-border: #6B90C5;
  }
}
```

- [ ] **Step 2: 更新 `web/src/styles/globals.css` — `.prose-cn` 加 font-family**

找到当前第 54–58 行：

```css
.prose-cn {
  line-height: var(--prose-line-height, 1.85);
  font-size: var(--prose-font-size, 15px);
  color: var(--text-primary);
}
```

替换为：

```css
.prose-cn {
  font-family: var(--prose-font-family, var(--font-sans));
  line-height: var(--prose-line-height, 1.85);
  font-size: var(--prose-font-size, 15px);
  color: var(--text-primary);
}
```

- [ ] **Step 3: 更新 `web/index.html` — 加 Source Serif 4 字体**

当前 `<head>` 内容（无字体 link）：

```html
<!doctype html>
<html lang="zh-CN" data-prose-theme="default">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Video Learner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

替换为：

```html
<!doctype html>
<html lang="zh-CN" data-prose-theme="default">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Video Learner</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: 运行测试确认 CSS 改动无副作用**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner/web && npm test
```

期望：18/18 passed（CSS 变化不影响 JS 测试）

- [ ] **Step 5: Commit**

```bash
git add web/src/styles/themes.css web/src/styles/globals.css web/index.html
git commit -m "feat: add academic prose theme CSS + font loading"
```

---

## Task 2: TypeScript 注册表 + 测试更新

**Files:**
- Modify: `web/src/lib/themes.ts`
- Modify: `web/src/stores/ui-store.test.ts`

**Interfaces:**
- Consumes: Task 1 产出（CSS 层就绪，academic 变量块存在）
- Produces:
  - `ThemeId = 'default' | 'academic'`（类型自动扩展）
  - `THEMES` 数组长度为 2，Picker 渲染「默认 / 学术」两个按钮
  - setter 测试覆盖 `'default' → 'academic'` 真实 round-trip

- [ ] **Step 1: 更新 `web/src/lib/themes.ts`**

将文件完整替换为：

```ts
export const THEMES = [
  { id: 'default',  label: '默认' },
  { id: 'academic', label: '学术' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
```

- [ ] **Step 2: 更新 `web/src/stores/ui-store.test.ts` — setter 测试改用 `'academic'`**

将文件完整替换为：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './ui-store';
import type { ThemeId } from '@/lib/themes';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ proseTheme: 'default' });
});

describe('ui-store proseTheme', () => {
  it('defaults to "default"', () => {
    expect(useUiStore.getState().proseTheme).toBe('default');
  });

  it('setProseTheme updates state', () => {
    useUiStore.getState().setProseTheme('academic');
    expect(useUiStore.getState().proseTheme).toBe('academic');
  });

  it('setProseTheme persists to localStorage', () => {
    useUiStore.getState().setProseTheme('academic');
    expect(localStorage.getItem('prose-theme')).toBe('academic');
  });

  it('initialises proseTheme from localStorage when a value is stored', () => {
    localStorage.setItem('prose-theme', 'academic');
    useUiStore.setState({
      proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
    });
    expect(useUiStore.getState().proseTheme).toBe('academic');
  });
});
```

- [ ] **Step 3: TypeScript 检查**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner/web && npx tsc --noEmit
```

期望：0 errors

- [ ] **Step 4: 运行全量测试**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner/web && npm test
```

期望：18/18 passed（setter 测试现在用 `'academic'` 做真实 round-trip）

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/themes.ts web/src/stores/ui-store.test.ts
git commit -m "feat: register academic theme in THEMES + update setter tests"
```

---

## 自检

**Spec 覆盖：**
- [x] `default` 块补 `--prose-font-family: var(--font-sans)`（Task 1 Step 1）
- [x] `academic` 块完整变量（Task 1 Step 1）
- [x] academic 深色模式覆盖块（Task 1 Step 1）
- [x] `.prose-cn` 消费 `font-family` 变量（Task 1 Step 2）
- [x] Source Serif 4 字体加载（Task 1 Step 3）
- [x] `THEMES` 注册表加 academic（Task 2 Step 1）
- [x] setter 测试改用 `'academic'` 验证真实 round-trip（Task 2 Step 2）
- [x] `tsc --noEmit` 检查（Task 2 Step 3）

**类型一致性：**
- `ThemeId = 'default' | 'academic'` — 由 `typeof THEMES[number]['id']` 自动派生，Task 2 定义，ui-store.ts 已有 `import { ThemeId } from '@/lib/themes'` 无需改动

**无占位符：**
- 每个步骤均含完整代码，无 TBD / TODO
