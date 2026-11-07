---
title: 为什么我又开了一个博客
description: 第十二次重启博客。这次不谈「坚持」，只谈怎么把写作的摩擦力降到最低。
pubDate: 2026-11-07
tags: ['随笔', 'Astro']
---

这大概是我第十二次搭博客。前十一套方案分别死于：主题改到凌晨三点、数据库迁移失败、以及「等我想好第一篇文章再上线」。

所以这次的目标很朴素：**让写作的摩擦力尽可能小**。写一个 `.md` 文件，`git push`，剩下的交给构建。

## 三个约束

动手之前先定规则，不然又会滑进「折腾配置」的坑里。

1. **内容即文件**。文章是仓库里的 Markdown，不依赖任何后台。想备份就是 `git clone`。
2. **零前端运行时**。除了一个主题切换按钮和代码复制，页面不需要 JavaScript。
3. **一个命令能跑起来**。`npm install && npm run dev`，不做环境变量配置。

## 技术选型

用过 Hexo、Hugo、Next.js 的静态导出，最后选了 [Astro](https://astro.build)。理由不复杂：

- 默认输出纯 HTML，组件只是构建期的模板，不会把框架塞进产物；
- 内容集合（Content Collections）带 schema 校验，frontmatter 写错会在构建时报错，而不是在线上悄悄渲染成空标题；
- Markdown 的代码高亮在构建期完成，用的是 Shiki，配色和 VS Code 一致。

代价是它不像 Hexo 那样装个主题就能跑。但对一个打算长期写的博客来说，能控制每一个像素反而更重要。

## 一次构建做了什么

```bash
$ npm run build
▶ src/pages/index.astro
  ├─ src/pages/blog/index.astro
  ├─ src/pages/blog/[id].astro (4 pages)
  ├─ src/pages/tags/[slug].astro (5 pages)
  └─ src/pages/rss.xml.ts
✓ Completed in 1.42s
```

产物落在 `dist/`，是一堆静态文件。扔到任意 CDN、对象存储或者 GitHub Pages 都能跑。

## 关于更新频率

不承诺日更，也不立 flag。写长一点，慢一点。

> 博客不是待办清单，它是一个人的思考留下的痕迹。痕迹不必密集，但最好是真的。

如果这个站哪天又消失了，大概率是我在改主题。
