import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * 站点地址解析顺序：
 *   1. SITE_URL —— 自定义域名时在 Netlify 环境变量里显式指定
 *   2. URL      —— Netlify 构建期自动注入的站点主地址
 *   3. 本地兜底
 * 它决定 canonical / og:url / RSS / sitemap 里的绝对链接。
 */
const site = process.env.SITE_URL || process.env.URL || 'https://example.com';

export default defineConfig({
  site,
  trailingSlash: 'always',
  integrations: [sitemap()],
  build: {
    format: 'directory',
  },
  markdown: {
    // 双主题：亮/暗可切换，由 global.css 里的 --shiki-* 变量控制
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      wrap: false,
    },
  },
  devToolbar: {
    enabled: false,
  },
});
