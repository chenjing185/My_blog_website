---
title: 部署到 Netlify 踩过的四个坑
description: 构建能过、上线有问题，往往是路径、锁文件和缓存头在作怪。把这几个坑记下来，下次省半小时。
pubDate: 2026-11-08
tags: ['Netlify', '部署', 'Astro']
category: 技术
series: 建站笔记
---

静态站部署本该是「连上仓库、点部署、完事」。但真正上线时，总有几个细节会把时间吃掉。

## 一、锁文件里的镜像地址

本地装依赖时为了快，用了国内镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

这条命令会把 `package-lock.json` 里每个包的 `resolved` 字段都写成镜像地址。Netlify 的构建机在美国，`npm ci` 会老老实实按锁文件去镜像站拉包——慢，甚至超时。

检查一下：

```bash
grep -c npmmirror package-lock.json
```

如果不是 0，就把地址统一换回官方源。`integrity` 是内容哈希，换域名不影响校验：

```bash
sed -i 's|registry.npmmirror.com|registry.npmjs.org|g' package-lock.json
```

## 二、canonical 指向了 example.com

`site` 决定 canonical、og:url、RSS 和 sitemap 里的绝对地址。写死成占位域名，上线后搜索引擎收录的就是那个域名。

改成从环境变量读，Netlify 构建期会自动注入 `URL`：

```js
const site = process.env.SITE_URL || process.env.URL || 'https://example.com';
```

绑定自定义域名后，`URL` 会变成你的域名，不用再改代码。

## 三、robots.txt 里的 sitemap 地址

静态文件 `public/robots.txt` 是原样拷贝的，里面的 sitemap 地址写死了就不会变。改成构建期生成：

```ts
// src/pages/robots.txt.ts
export const GET = ({ site }) => {
  const origin = site.href.replace(/\/$/, '');
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap-index.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
```

## 四、尾斜杠导致的两个 URL

`trailingSlash: 'always'` 配合目录式输出后，`/blog/post/` 和 `/blog/post` 都能访问到同一份内容，搜索引擎会当成两个页面。

| 配置 | 作用 |
| --- | --- |
| `trailingSlash: 'always'` | 构建期统一生成带斜杠的链接 |
| `netlify.toml` 的 301 | 把无斜杠访问重定向到带斜杠版本 |

```toml
[[redirects]]
  from = "/blog/:slug"
  to = "/blog/:slug/"
  status = 301
```

> 部署这件事，能自动化的都别手改。凡是「上线前记得改一下」的步骤，早晚会忘。
