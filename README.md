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
├── netlify.toml             # Netlify 构建 / 缓存 / 安全头配置
├── .nvmrc                   # Node 版本（22）
├── public/                  # 原样拷贝的静态资源（favicon、封面图 covers/）
└── src/
    ├── consts.ts            # ★ 站点配置：标题、作者、导航、Giscus、不蒜子
    ├── content.config.ts    # ★ 文章集合的 schema（frontmatter 字段定义）
    ├── content/blog/        # ★ 文章放这里，文件名即 URL
    ├── components/          # Header / Footer / PostCard / TOC / Giscus / CommandPalette ...
    ├── layouts/
    │   └── BaseLayout.astro # HTML 骨架、head、主题脚本、代码复制/折叠、图片放大
    ├── pages/
    │   ├── index.astro      # 首页（置顶 + 最新 + 专栏 + 标签）
    │   ├── blog/            # 列表 + [id] 详情
    │   ├── archives/        # 归档时间轴（年 → 月 → 文章）
    │   ├── categories/      # 分类总览 + [slug] 分类页
    │   ├── collections/     # 专栏总览 + [slug] 专栏目录
    │   ├── tags/            # 标签总览 + [slug] 标签页
    │   ├── admin/           # 写作台（手机发文，见 docs/手机写博客.md）
    │   ├── about.astro
    │   ├── search.astro     # 搜索页（命令面板的后备入口）
    │   ├── search.json.ts   # 构建期生成的搜索索引
    │   ├── robots.txt.ts    # 构建期生成，sitemap 地址跟随站点域名
    │   ├── rss.xml.ts
    │   └── 404.astro
    ├── scripts/admin/       # 写作台逻辑（lib/ 下是可在 Node 里单测的纯函数）
    ├── styles/global.css    # 设计令牌 + 全部基础样式
    └── utils/               # 日期、阅读时长、分类/专栏/标签聚合、相关文章
```

## 写一篇新文章

在 `src/content/blog/` 新建 `my-post.md`，文件名就是 URL：`/blog/my-post/`。

```markdown
---
title: 文章标题
description: 一句话摘要，用于列表卡片、SEO 和 RSS
pubDate: 2026-11-07
updatedDate: 2026-11-08    # 可选
category: 技术             # 可选，单值分类
tags: ['Astro', 'TypeScript']
series: 建站笔记           # 可选，同名自动聚合成专栏
pinned: false              # 可选，置顶到首页
draft: false               # 可选，true 时不出现在列表/RSS/sitemap
link: https://example.com  # 可选，外链文章：列表直接跳外链
subtitle: 可选副标题
cover: /images/xxx.jpg     # 可选，列表缩略图 + og:image
---

正文用 Markdown 写。
```

| 字段            | 类型       | 必填 | 说明                              |
| ------------- | -------- | -- | ------------------------------- |
| `title`       | string   | ✅  | 最长 120 字符                       |
| `description` | string   | ✅  | 最长 300 字符                       |
| `pubDate`     | date     | ✅  | `YYYY-MM-DD`                    |
| `updatedDate` | date     |    | 显示「更新于」                         |
| `category`    | string   |    | 单值分类，自动生成 `/categories/<slug>/` |
| `tags`        | string[] |    | 默认空数组                           |
| `series`      | string   |    | 同名聚合为专栏，文章页显示进度与同系列上下篇          |
| `pinned`      | boolean  |    | 置顶到首页「pinned」区，列表卡片带标记          |
| `draft`       | boolean  |    | 默认 `false`                      |
| `link`        | url      |    | 外链文章：列表卡直接跳外链，详情页展示跳转提示         |
| `cover`       | string   |    | 列表缩略图，也用作 og:image              |
| `subtitle`    | string   |    | 标题下的补充说明                        |

字段写错会在构建时直接报错——这是有意为之，避免线上出现空标题。

**草稿预览**：`draft: true` 的文章在 `npm run dev` 下可直接访问并带 `draft` 标记，但不会进入生产构建的列表、RSS、sitemap 和搜索索引。

**二级目录**：目前 `src/pages/blog/[id].astro` 只支持单层文件名。如果想把文章按年份分目录，把文件重命名为 `[...id].astro` 即可支持 `2026/my-post.md` → `/blog/2026/my-post/`。

## 在手机上写文章（写作台）

仓库自带一个给自己用的手机写作台：打开 <https://lastembryo.netlify.app/admin/>，粘贴一个 GitHub 细粒度令牌后，就能在手机上新建 / 修改 / 删除文章、上传图片。**保存 = 向 `main` 分支提交 commit**，Netlify 检测到推送后自动重新构建，约 1 分钟站点更新。

- 令牌：Fine-grained PAT，仅勾选本仓库，Repository permissions → Contents 设为 **Read and write**
- 令牌只存在手机浏览器的 localStorage，不会进仓库；万一泄露，去 GitHub 吊销即可
- 只是页面，没有后端：浏览器直接调用 GitHub API，所以不需要额外部署或 OAuth 服务
- 想先看看界面、不写仓库：打开 `/admin/?demo=1` 演示模式
- 详细步骤和故障排查：**[docs/手机写博客.md](docs/手机写博客.md)**

写作台是给自己用的工具页，已经 `noindex` 且从 sitemap 里排除，不会出现在站点导航里。

做得比较细的几处，写文章时会用到：

| 能力 | 说明 |
| --- | --- |
| 本机草稿分槽位 | 每篇文章各自一份草稿，写到一半切去改别的不会互相覆盖；列表页顶部列出所有未保存的草稿，可「继续写」或「丢弃」 |
| 断网兜底 | 保存时网络不通，内容会立刻转存为本机草稿，联网后打开这篇点「恢复」继续提交 |
| 冲突保护 | 文件在别处被改过时（409）先问再覆盖，并把被覆盖的远端版本留在本机草稿里 |
| 重命名原子提交 | 改名走 Git Data API，新文件与旧文件删除在同一个 commit 里，不会留下「两篇同名文章」 |
| 图片库 | 列出 `public/uploads/` 下已上传的图，可直接插入正文、设为封面或删除；正文支持粘贴 / 拖拽多图 |
| 离线与安装 | 带 Service Worker：断网仍能打开写作台读草稿，Android Chrome 也会给「安装应用」 |
| 列表缓存 | 按文件 sha 缓存 frontmatter，第二次刷新只拉变化的文件，手机上不再逐篇转圈 |
| 输入补全 | 分类 / 标签 / 专栏会从已有文章里汇总成候选，避免手打出同义标签 |
| 其他 | 令牌保存超过 80 天提醒换新；设置里填 Netlify 站点名后可直接跳部署记录 |

相关文件：页面 `src/pages/admin/index.astro`，逻辑 `src/scripts/admin/main.js`（lib/ 下是可在 Node 里单测的纯函数），离线脚本 `public/admin/sw.js`，单测在 `scripts/test-admin-*.mjs`（`npm test`）。

## 改成你自己的

### 1. 站点信息

改 `src/consts.ts`：站名、副标题、作者、导航项、社交链接。

### 2. 域名

`site` 现在由环境变量解析（见 `astro.config.mjs`），顺序为：

```
SITE_URL  →  Netlify 注入的 URL  →  https://example.com
```

也就是说：**部署到 Netlify 后不用手改代码**，构建时会自动取站点的 `.netlify.app` 地址；绑定自定义域名后，Netlify 注入的 `URL` 会变成你的域名。

只有在需要强制指定（例如站点绑定了多个域名，想固定用其中一个做 canonical）时，才在 Netlify 站点设置里加环境变量：

```
SITE_URL = https://your-domain.com
```

它决定 canonical、og:url、RSS、sitemap 和 robots.txt 里的绝对链接。

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

## 部署到 Netlify

项目已经为 Netlify 做好配置，仓库根目录的 `netlify.toml` 包含构建命令、Node 版本、缓存头和统一尾斜杠的 301 规则。

```
netlify.toml     构建配置（已写好，无需改）
.nvmrc           Node 22
dist/            产物目录（publish）
```

### 方式一：连 Git 仓库（推荐，改一篇文章即自动发布）

1. 把仓库推到 GitHub / GitLab / Gitee
2. Netlify 控制台 → **Add new site → Import an existing project** → 选择仓库
3. 构建配置会被 `netlify.toml` 自动读取，直接点 **Deploy**：
   | 项                 | 值                 |
   | ----------------- | ----------------- |
   | Build command     | `  npm run build` |
   | Publish directory | `dist`            |
   | Node version      | `22`              |
4. 约 1 分钟构建完成，拿到 `https://<随机名>.netlify.app`
5. 想改地址：**Site configuration → Change site name**

### 方式二：命令行部署（不想连 Git）

```bash
npm i -g netlify-cli
netlify login
npm run build
netlify deploy --prod --dir=dist
```

首次执行会让你选择或新建站点。

### 绑定自定义域名

1. **Domain management → Add a domain**，填入你的域名
2. 按提示在 DNS 服务商处添加记录：
   - 根域名：`A` 记录指向 Netlify 的负载均衡 IP
   - `www` 子域名：`CNAME` 指向 `<your-site>.netlify.app`
3. Netlify 自动签发 Let's Encrypt 证书（几分钟内生效，HTTP 会自动 301 到 HTTPS）

换好域名后重新部署一次，让 canonical / sitemap / robots.txt 使用新域名。

### 需要注意的两点

- **不要删 `netlify.toml`**：里面的 `_astro/*` 缓存头是「内容不变则永不重新下载」的关键，删掉后每次访问都要回源。
- **`package-lock.json` 已把依赖地址归一化到 `registry.npmjs.org`**。如果你在本地重新 `npm i` 时用了国内镜像，锁文件会被改回镜像地址，Netlify（美国机房）拉包会变慢——发布前可以检查一下：`grep -c npmmirror package-lock.json`，应为 0。

## 其他部署方式

产物是纯静态文件，任何静态托管都行。

### Vercel / Cloudflare Pages

导入仓库即可，构建配置同上（Build `npm run build`，Output `dist`）。

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

## 评论与统计

### Giscus 评论（基于 GitHub Discussions，零后端）

1. 仓库 **Settings → General → Features** 勾选 `Discussions`
2. 在 <https://github.com/apps/giscus> 把 Giscus App 安装到该仓库
3. 打开 <https://giscus.app/zh-CN>，填入仓库名，选择映射方式 `pathname`、分类 `Announcements`
4. 把页面生成的 `data-repo`、`data-repo-id`、`data-category-id` 填进 `src/consts.ts`：

```ts
export const GISCUS = {
  repo: 'lastembryo/myblog',   // 你的仓库
  repoId: 'R_kgDOxxxxxx',
  category: 'Announcements',
  categoryId: 'DIC_kwDOxxxxxx',
};
```

留空则整块评论不渲染（不影响构建）。评论框主题会跟随站点的明暗切换自动同步。

### 不蒜子统计（免费、无需注册）

`src/consts.ts` 里的 `STATS` 控制：

```ts
export const STATS = {
  enabled: true,        // 总开关（关闭则不加载脚本）
  showSiteStats: true,  // 页脚：总访问量 / 访客数
  showPageViews: true,  // 文章页：本篇阅读次数
};
```

数据由 <https://busuanzi.ibruce.info> 提供，按域名独立计数。若服务偶发不可用，页脚统计会自动隐藏，不影响页面。

## 命令

| 命令                | 作用                      |
| ----------------- | ----------------------- |
| `npm run dev`     | 启动开发服务器（热更新）            |
| `npm run build`   | 构建到 `dist/`             |
| `npm run preview` | 预览构建产物                  |
| `npm run check`   | TypeScript / Astro 类型检查 |

## 环境说明

本项目使用 **Astro 6.4.8**，要求 Node **>= 22.12.0**。

当前机器是 Node 22.22.2。Astro 7 要求 `>= 22.23.4`，升级 Node 后可执行：

```bash
npx @astrojs/upgrade
```

Astro 7 的注意点：Markdown 默认改用 Sätteri 渲染管线（本项目没用到 remark/rehype 插件，可直接升级）、`compressHTML` 默认变为 `'jsx'`（内联元素间的空格会被压缩）。

## 许可

文章内容采用 CC BY-NC-SA 4.0，代码部分随意取用。
