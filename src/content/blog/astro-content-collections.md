---
title: Astro 内容集合：把 Markdown 当成数据库
description: 用 schema 校验 frontmatter，用 glob loader 读取目录，用 getCollection 查询、排序、过滤——以及几个容易踩的坑。
pubDate: 2026-11-02
tags: ['Astro', 'TypeScript']
category: 技术
series: 建站笔记
---

Astro 的内容集合（Content Collections）本质上是一个**构建期的简易 ORM**：目录是表，文件是行，frontmatter 是列，而 `zod` schema 是建表语句。

## 定义一张「表」

内容集合的配置文件放在 `src/content.config.ts`，不是 `src/content/` 目录下——这一点和 Astro 4 时代的写法不同，很多人升级后会在这里卡住。

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
```

几个要点：

- `z.coerce.date()` 让 `pubDate: 2026-11-02` 这种字符串自动转成 `Date`，不用在模板里到处 `new Date()`；
- `.default([])` 让 `tags` 可省略，省掉一堆 `?? []`；
- schema 校验失败会**中断构建**，这是好事：宁可在本地报错，也不要线上出现一张没有标题的卡片。

## 查询与排序

`getCollection()` 返回的顺序是**不确定的**，官方文档明确说过。所以永远自己排：

```ts
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
  (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
);
```

第二个参数是过滤器，草稿在生产环境直接不进内存。

## 渲染正文

`render()` 返回组件和标题树，标题树可以直接喂给目录组件：

```astro
---
import { getEntry, render } from 'astro:content';

const post = await getEntry('blog', 'hello-world');
if (!post) throw new Error('文章不存在');

const { Content, headings } = await render(post);
---

<article class="prose">
  <Content />
</article>
```

`headings` 长这样，`depth` 是标题级别，`slug` 已经过 URL 处理：

```ts
[
  { depth: 2, slug: '定义一张表', text: '定义一张「表」' },
  { depth: 3, slug: '查询与排序', text: '查询与排序' },
]
```

## 三个坑

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 配置文件位置放错 | 集合始终是空的 | 放 `src/content.config.ts` |
| 忘了 `loader` | 构建报缺少 loader | 每个集合都要声明 `loader` |
| 中文标题锚点 | `#中文标题` 跳转失败 | 比较时先 `decodeURIComponent` |

> 中文锚点在浏览器里会被百分号编码，`location.hash` 拿到的是 `%E4%B8%AD%E6%96%87`。做滚动高亮时必须解码，否则永远匹配不上。

最后一条我调了半小时。记在这里，省你半小时。
