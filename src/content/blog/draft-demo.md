---
title: 草稿示例：还没想好的那篇
description: 这是一篇 draft，用来演示草稿机制——生产构建里看不到它。
pubDate: 2026-11-05
tags: ['随笔']
category: 随笔
draft: true
---

这篇的 `draft: true`，所以：

- `npm run build` 之后不会出现在文章列表、RSS、sitemap 和搜索索引里；
- `npm run dev` 时可以直接访问 `/blog/draft-demo/` 预览，列表里会带一个 `draft` 标记。

写完之后把 `draft: true` 删掉（或改成 `false`），它就会正式发布。
