# 详情页总结/文章模块大屏左对齐修复

**日期**: 2026-06-25
**优先级**: P2
**影响范围**: `web/src/styles/globals.css`（一行改动）

## 问题描述

详情页 `panel-right` 区域内的 `.article-notes-row` 使用 `margin: 0 auto` 居中布局，配合 `max-width: 1040px`。在大屏幕下（如 2560px 宽的显示器），Mode E（沉浸阅读）等全宽模式下，内容块两侧各留出约 760px 空白，且文章内容左边起点与上方 tab 栏（`px-12` = 48px 左内边距）不对齐，视觉割裂。

## 设计决策

**方案 A**：去掉 `margin: 0 auto`，改为 `margin: 0`。

选择理由：
- 改动最小（一行），风险极低
- `article-col` 自身已有 `padding: 56px 48px`（左 48px），与 tab 栏的 `px-12`（左 48px）天然对齐，无需引入额外魔法数字
- 各模式已有的 per-mode `article-col` max-width 约束（Mode B/C/F: 720px，Mode E: 680px）继续生效，行长可读性不受影响
- 超宽屏右侧留白可接受，符合阅读界面惯例

排除方案：
- **固定左缩进**（`margin-left: 48px`）：与 `article-col` 内部 padding 叠加，左边距达 96px，过宽
- **去掉 max-width**：行宽在超宽屏下失控，阅读体验差

## 变更内容

**文件**: `web/src/styles/globals.css`，约第 123 行

```css
/* 修改前 */
.article-notes-row {
  display: flex;
  max-width: 1040px;
  margin: 0 auto;
  width: 100%;
}

/* 修改后 */
.article-notes-row {
  display: flex;
  max-width: 1040px;
  margin: 0;
  width: 100%;
}
```

## 影响的布局模式

| Mode | 说明 | 修复效果 |
|------|------|---------|
| A（视频优先）| panel-right 约 45% 宽，notes-col 隐藏 | 通常不触发，影响极小 |
| B（阅读优先）| panel-right 全宽减 320px sidebar | 内容从左对齐，tab 栏与正文左边对齐 |
| C（音频+文章）| panel-right 全宽减 280px subtitle-col | 同上 |
| E（沉浸阅读）| panel-right 全宽，问题最明显 | 修复最显著 |
| F（剧场模式）| panel-right 全宽 | 同 E |

## 验证标准

1. 在宽屏（≥1440px）下，Mode E 中文章内容左边与 tab 栏"总结/文章"文字左边对齐
2. 各模式切换后布局无错位
3. 窄屏（≤768px）下无回退问题（max-width 不触发，`width: 100%` 保持正常）
