# myblog

一个用 [Astro](https://astro.build) 搭建的静态博客。暗色优先、等宽字体排版、零前端框架运行时。

- **内容即文件** —— 文章是 `src/content/blog/` 下的 Markdown，frontmatter 有 schema 校验
- **构建即高亮** —— 代码高亮由 Shiki 在构建期完成，输出纯 HTML/CSS
- **该有的都有** —— 标签聚合、文章目录、阅读时长、上下篇、阅读进度、站内搜索、RSS、sitemap、深浅主题
- **几乎没 JS** —— 全站 JS 只有主题切换、代码复制、目录高亮、进度条、搜索页

## 快速开始

```bash
npm install
npm run dev        # http://localhost:4321
```

生产构建：

```bash
npm run build      # 产物在 dist/
npm run preview    # 本地预览产物
```

> 首次 `npm install` 如果很慢，是 registry 拉取元数据的问题，可以换镜像：
> `npm install --registry=https://registry.npmmirror.com`

## 目录结构

```
├── astro.config.mjs         # 站点 URL、Markdown 高亮主题、sitemap
├── public/                  # 原样拷贝的静态资源（favicon、robots.txt）
└── src/
    ├── consts.ts            # ★ 站点配置：标题、作者、导航、社交链接
    ├── content.config.ts    # ★ 文章集合的 schema（frontmatter 字段定义）
    ├── content/blog/        # ★ 文章放这里，文件名即 URL
    ├── components/          # Header / Footer / PostCard / TOC ...
    ├── layouts/
    │   └── BaseLayout.astro # HTML 骨架、head、主题脚本、代码复制脚本
    ├── pages/
    │   ├── index.astro      # 首页
    │   ├── blog/            # 列表 + [id] 详情
    │   ├── tags/            # 标签总览 + [slug] 标签页
    │   ├── about.astro
    │   ├── search.astro     # 站内搜索（读取 /search.json）
    │   ├── search.json.ts   # 构建期生成的搜索索引
    │   ├── rss.xml.ts
    │   └── 404.astro
    ├── styles/global.css    # 设计令牌 + 全部基础样式
    └── utils/               # 日期、阅读时长、标签聚合、相邻文章
```

## 写一篇新文章

在 `src/content/blog/` 新建 `my-post.md`，文件名就是 URL：`/blog/my-post/`。

```markdown
---
title: 文章标题
description: 一句话摘要，用于列表卡片、SEO 和 RSS
pubDate: 2026-11-07
updatedDate: 2026-11-08    # 可选
tags: ['Astro', 'TypeScript']
draft: false               # 可选，true 时不出现在列表/RSS/sitemap
subtitle: 可选副标题
cover: /images/xxx.jpg     # 可选，同时作为 og:image
---

正文用 Markdown 写。
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | ✅ | 最长 120 字符 |
| `description` | string | ✅ | 最长 300 字符 |
| `pubDate` | date | ✅ | `YYYY-MM-DD` |
| `updatedDate` | date | | 显示「更新于」 |
| `tags` | string[] | | 默认空数组 |
| `draft` | boolean | | 默认 `false` |
| `cover` | string | | 也用作 og:image |
| `subtitle` | string | | 标题下的补充说明 |

字段写错会在构建时直接报错——这是有意为之，避免线上出现空标题。

**草稿预览**：`draft: true` 的文章在 `npm run dev` 下可直接访问并带 `draft` 标记，但不会进入生产构建的列表、RSS、sitemap 和搜索索引。

**二级目录**：目前 `src/pages/blog/[id].astro` 只支持单层文件名。如果想把文章按年份分目录，把文件重命名为 `[...id].astro` 即可支持 `2026/my-post.md` → `/blog/2026/my-post/`。

## 改成你自己的

### 1. 站点信息

改 `src/consts.ts`：站名、副标题、作者、导航项、社交链接。

### 2. 域名（**部署前必改**）

`astro.config.mjs` 里的 `site`，以及 `public/robots.txt` 里的 sitemap 地址：

```js
site: 'https://your-domain.com',
```

它决定 canonical、og:url、RSS 和 sitemap 里的绝对链接。

### 3. 配色与排版

全部设计令牌集中在 `src/styles/global.css` 顶部：

```css
:root {
  --bg: #0a0c10;        /* 背景 */
  --text: #e6edf3;      /* 正文 */
  --accent: #2dd4bf;    /* 强调色 */
  --font-mono: ...;     /* 等宽字体栈 */
  --prose: 68ch;        /* 正文栏宽 */
}

[data-theme='light'] { /* 亮色主题的同一组变量 */ }
```

### 4. 代码高亮主题

`astro.config.mjs` 里 `markdown.shikiConfig.themes`，可换成任意 [Shiki 主题](https://shiki.style/themes) 名称（`light` / `dark` 各一个，CSS 会自动切换）。

## 部署

产物是纯静态文件，任何静态托管都行。

### Vercel / Netlify

导入仓库即可，框架会被自动识别：

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |

### GitHub Pages

`.github/workflows/deploy.yml`：

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

如果部署在 `https://<user>.github.io/<repo>/`，还需要在 `astro.config.mjs` 里加 `base: '/<repo>'`，并把站内绝对链接改为使用 `import.meta.env.BASE_URL`。

### 对象存储 / 自建服务器

把 `dist/` 整个目录上传即可。注意两点：

- 404 页面需要在托管侧配置 fallback 到 `404.html`
- 保持 URL 尾斜杠：本项目使用 `trailingSlash: 'always'` + `build.format: 'directory'`

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器（热更新） |
| `npm run build` | 构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run check` | TypeScript / Astro 类型检查 |

## 环境说明

本项目使用 **Astro 6.4.8**，要求 Node **>= 22.12.0**。

当前机器是 Node 22.22.2。Astro 7 要求 `>= 22.23.4`，升级 Node 后可执行：

```bash
npx @astrojs/upgrade
```

Astro 7 的注意点：Markdown 默认改用 Sätteri 渲染管线（本项目没用到 remark/rehype 插件，可直接升级）、`compressHTML` 默认变为 `'jsx'`（内联元素间的空格会被压缩）。

## 许可

文章内容采用 CC BY-NC-SA 4.0，代码部分随意取用。
