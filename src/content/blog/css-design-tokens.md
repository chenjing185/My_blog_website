---
title: 用 CSS 变量搭一套设计令牌
description: 别急着上 Tailwind。一套两百行的设计令牌，足够支撑一个站点从暗色到亮色的全部切换。
pubDate: 2026-10-24
updatedDate: 2026-10-28
tags: ['CSS', '设计系统']
category: 设计
series: 前端手记
cover: /covers/theme.svg
---

设计令牌（design tokens）这个词听起来很企业，实际上就是把「颜色、间距、字体、圆角」从散落各处的硬编码里抽出来，变成一组有名字的变量。

## 先分层，再赋值

令牌分三层，顺序不能乱：

1. **基础层**：原始值，比如 `#0a0c10`。这一层不带语义。
2. **语义层**：`--bg`、`--text-muted`、`--border`。这一层才是组件里该用的东西。
3. **组件层**：组件自己的局部变量，只在必要时出现。

```css
:root {
  color-scheme: dark;

  /* 基础层 */
  --gray-950: #0a0c10;
  --gray-100: #e6edf3;
  --teal-400: #2dd4bf;

  /* 语义层 */
  --bg: var(--gray-950);
  --text: var(--gray-100);
  --accent: var(--teal-400);
  --border: #1d2530;
}
```

组件里只写 `background: var(--bg)`，不写十六进制。这样换主题时只需要改语义层的映射。

## 主题切换就是换一组映射

```css
[data-theme='light'] {
  color-scheme: light;
  --bg: #fcfcfb;
  --text: #12181d;
  --accent: #0d9488;
  --border: #e2e5e3;
}
```

配合一行 JavaScript 就够了：

```js
const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
document.documentElement.dataset.theme = next;
localStorage.setItem('theme', next);
```

注意 `color-scheme` 必须跟着一起改。它决定浏览器默认控件（滚动条、输入框、`<select>`）用什么配色，忘了写就会出现「暗色页面里一个雪白的下拉框」。

## 三个容易被忽略的细节

- **首屏闪烁**。主题脚本必须内联在 `<head>` 最前面，且要在样式表加载之前执行，否则会闪一下白。
- **对比度**。亮色主题下的 `--text-muted` 很容易做浅，正文小字建议不低于 `#555`，对比度才够 4.5:1。
- **别用 `color-mix` 做核心色**。它的浏览器支持已经不差了，但混合结果在暗色背景下往往偏脏。宁可多写两个变量。

## 间距也应该令牌化

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

一开始会觉得啰嗦，等到需要整体调紧或放松留白时，你就知道值了——改 6 个数字，全站生效。

> 设计系统不是设计出来的，是删出来的。每加一个令牌，都要问自己：这个东西会不会在三个以上的地方出现？
