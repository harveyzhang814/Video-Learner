# Prose Theme Academic 设计文档

## 概述

在现有双文件主题体系（`themes.css` + `themes.ts`）上新增第二套阅读主题：**学术（academic）**。衬线字体 + 冷蓝石板配色，与默认主题形成明确的视觉区分，供用户通过 `ProseThemePicker` 自由切换。

## 背景

当前主题系统已完整支持多主题切换：`themes.css` 用 `:root[data-prose-theme="X"]` 选择器定义变量，`themes.ts` 维护注册表，Picker 自动渲染所有条目。新增主题只需改两个文件。但现有变量集缺少 `--prose-font-family`，需同步扩展一次变量层，之后再加主题无需再改元素样式。

## 目标

- 新增 `academic` 主题，视觉上区别于 `default`：衬线字体、冷蓝 accent
- 深色模式下配色正确适配
- 不改动任何非主题相关代码；不引入新 npm 包

## 不在范围内

- 不改 `.prose-cn` 元素布局或间距逻辑（只动变量层）
- 不设计第三套主题
- 不改 `article.html` fixture 的内联 CSS（保持 file:// 兼容）

---

## 文件改动

| 文件 | 操作 | 内容 |
|------|------|------|
| `web/src/styles/themes.css` | 修改 | 在 `default` 块补 `--prose-font-family`；追加 `academic` 块 + 深色覆盖块 |
| `web/src/lib/themes.ts` | 修改 | `THEMES` 加一行 `{ id: 'academic', label: '学术' }` |
| `web/src/styles/globals.css` | 修改 | `.prose-cn` 加 `font-family: var(--prose-font-family, var(--font-sans))` |
| `web/index.html` | 修改 | 加 Source Serif 4 Google Font `<link>` |
| `web/src/stores/ui-store.test.ts` | 修改 | `ThemeId` 现在包含 `'academic'`，更新 setter 测试使用新值验证 round-trip |

---

## 变量规格

### `default` 主题补充

在已有变量末尾加一行：

```css
--prose-font-family: var(--font-sans);
```

### `academic` 主题块（浅色）

```css
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
```

### `academic` 深色覆盖

```css
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

`--prose-font-family` 和排版尺度在深色下不变，无需覆盖。

---

## globals.css 改动

`.prose-cn` 当前：

```css
.prose-cn {
  line-height: var(--prose-line-height, 1.85);
  font-size: var(--prose-font-size, 15px);
  color: var(--text-primary);
}
```

改后（加一行）：

```css
.prose-cn {
  font-family: var(--prose-font-family, var(--font-sans));
  line-height: var(--prose-line-height, 1.85);
  font-size: var(--prose-font-size, 15px);
  color: var(--text-primary);
}
```

---

## index.html 改动

在已有 Inter + JetBrains Mono 的 `<link>` 之后加：

```html
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet" />
```

---

## themes.ts 改动

```ts
export const THEMES = [
  { id: 'default',  label: '默认' },
  { id: 'academic', label: '学术' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
```

`ThemeId` 自动变为 `'default' | 'academic'`，无需手改类型。

---

## ui-store.test.ts 改动

`setProseTheme` 的 setter 测试改用 `'academic'` 以验证真实类型约束（round-trip 从 `'default'` 切换到 `'academic'`）：

```ts
it('setProseTheme updates state', () => {
  useUiStore.getState().setProseTheme('academic');
  expect(useUiStore.getState().proseTheme).toBe('academic');
});

it('setProseTheme persists to localStorage', () => {
  useUiStore.getState().setProseTheme('academic');
  expect(localStorage.getItem('prose-theme')).toBe('academic');
});
```

---

## 数据流

```
themes.css (academic block)
  └─@import──► globals.css → 浏览器解析 --prose-* 变量
                             → .prose-cn 使用 var(--prose-font-family) 等

themes.ts (THEMES array)
  └─import──► prose-theme-picker.tsx → 渲染"默认 / 学术"两个按钮
  └─import──► ui-store.ts → ThemeId = 'default' | 'academic'

用户点击"学术"
  → setProseTheme('academic')
  → localStorage.setItem('prose-theme', 'academic')
  → document.documentElement.dataset.proseTheme = 'academic'
  → :root[data-prose-theme="academic"] 变量生效
  → .prose-cn 字体 / 颜色即时切换
```

---

## 测试策略

- `npm test` 18 + N 个测试全部通过（setter 测试覆盖新 round-trip）
- `tsc --noEmit` 0 errors（ThemeId 扩展后自动类型安全）
- 浏览器手动验收：切换两套主题，确认字体、链接色、代码块色在深浅两种系统模式下均正确

---

## 规格自检

- [x] 无 TBD / TODO 占位
- [x] 无内部矛盾（font-family 只在 themes.css 中定义，globals.css 消费）
- [x] 范围聚焦（只动变量层 + 注册表，元素样式零修改）
- [x] 无歧义（颜色值精确到十六进制，深色模式覆盖块明确）
