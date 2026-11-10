import type { APIRoute } from 'astro';

/**
 * 构建期生成 robots.txt，sitemap 地址跟随 astro.config.mjs 的 site，
 * 避免换域名时漏改一处。
 */
export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://example.com')).href.replace(/\/$/, '');

  const body = `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${origin}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
