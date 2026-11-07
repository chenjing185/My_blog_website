import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// ⚠️ 部署前把 site 改成你的真实域名（影响 canonical / RSS / sitemap 的绝对链接）
export default defineConfig({
  site: 'https://example.com',
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
