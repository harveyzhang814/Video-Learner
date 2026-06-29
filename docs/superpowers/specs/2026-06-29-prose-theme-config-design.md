# Prose Theme Config File System 设计文档

## 概述

将 `globals.css` 中内联的主题变量块拆分为独立配置文件体系，使添加新主题只需新建一个 CSS 块 + 在注册表加一行，其他文件零修改。

## 背景

当前 `:root[data-prose-theme="default"] { --prose-* }` 变量直接内联在 `globals.css`，`THEMES` 数组硬写在 `prose-theme-picker.tsx` 组件内。添加新主题需要改两个不相关的文件，且 CSS 和元数据没有统一入口。

## 目标

- 视觉配置（变量值）与注册表元数据（id/label）分别有独立文件
- 新增主题：`themes.css` 加一个选择器块 + `themes.ts` 加一行
- `article.html` fixture 内联 CSS 结构与 `themes.css` 保持一致，方便未来改为 `<link>` 引用

## 不在范围内

- 不设计第二套主题的具体视觉（样式值留空或复制 default）
- 不改 `.prose-cn` 元素样式（只动变量层）
- 不改 `article.html` 的引用方式（仍为内联，保持 file:// 可打开）
- 不引入新 npm 包

---

## 文件结构

```
web/src/styles/
  globals.css          修改：移除内联变量块，改为 @import "./themes.css"
  themes.css           新建：所有 :root[data-prose-theme="..."] 变量块

web/src/lib/
  themes.ts            新建：THEMES 注册表 + ThemeId 类型导出

web/src/components/
  prose-theme-picker.tsx  修改：THEMES 改为从 themes.ts import

web/src/stores/
  ui-store.ts          修改：proseTheme 类型从 string 收窄为 ThemeId

web/preview/
  article.html         修改：<style> 内注释标注来源为 themes.css，同步变量结构
```

---

## 各文件规格

### `web/src/styles/themes.css`（新建）

包含所有主题的 CSS 变量定义，每主题一个 `:root` 选择器块：

```css
/* ── Theme: default ── */
:root[data-prose-theme="default"] {
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

/* ── Theme: minimal（示例占位，视觉值待设计） ── */
/* :root[data-prose-theme="minimal"] { ... } */
```

### `web/src/lib/themes.ts`（新建）

注册表只管元数据，不涉及任何 CSS 值：

```ts
export const THEMES = [
  { id: 'default', label: '默认' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
```

### `web/src/styles/globals.css`（修改）

移除 `:root[data-prose-theme="default"] { ... }` 块（约第 27–48 行），在 `:root { ... }` 设计系统变量块之后插入：

```css
@import "./themes.css";
```

其余内容不动。

### `web/src/components/prose-theme-picker.tsx`（修改）

将本地 `THEMES` 定义替换为 import：

```ts
// 删除：
// const THEMES = [{ id: 'default', label: '默认' }] as const;

// 新增：
import { THEMES } from '@/lib/themes';
```

组件其余逻辑不变。

### `web/src/stores/ui-store.ts`（修改）

```ts
import { ThemeId } from '@/lib/themes';

// proseTheme 类型从 string 收窄：
proseTheme: ThemeId;
setProseTheme: (theme: ThemeId) => void;

// 初始化保持不变，强制转型：
proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
```

### `web/preview/article.html`（修改）

`<style>` 块中主题变量部分添加注释，标注其来源为 `themes.css`，方便未来改为外部引用：

```html
<style>
  /* ── Prose theme tokens (source: web/src/styles/themes.css) ── */
  :root[data-prose-theme="default"] {
    ...
  }
</style>
```

---

## 数据流

```
themes.css  ──@import──►  globals.css  →  浏览器解析 CSS 变量
themes.ts   ──import──►  prose-theme-picker.tsx  →  渲染下拉列表
themes.ts   ──import──►  ui-store.ts  →  ThemeId 类型约束
```

---

## 添加新主题（未来操作）

1. 在 `themes.css` 新增 `:root[data-prose-theme="minimal"] { --prose-* }`
2. 在 `themes.ts` 的 `THEMES` 数组加 `{ id: 'minimal', label: '极简' }`
3. 无需改动 picker、store、layout、globals.css

---

## 测试策略

- 运行 `npm test`（18 个现有测试全部通过）
- `tsc --noEmit` 0 错误（ThemeId 类型收窄需验证）
- 浏览器打开 `web/preview/article.html`，确认默认主题样式不变
- 在运行中的 Web 端切换主题，确认 picker 行为正常

---

## 规格自检

- [x] 无 TBD 占位（minimal 主题明确标注为"视觉值待设计"，不是实现漏洞）
- [x] 无内部矛盾（数据流单向：themes.css → globals, themes.ts → picker/store）
- [x] 范围聚焦（只动变量层和注册表，元素样式/布局零修改）
- [x] 无歧义（`@import` 路径、类型导入路径均明确）
