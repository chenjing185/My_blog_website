import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * 博客文章集合
 * 新增文章：在 src/content/blog/ 下建 .md 文件，文件名即 URL slug
 */
const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    /** true 时不会出现在列表、RSS、sitemap 中，但 dev 下可直接访问 */
    draft: z.boolean().default(false),
    /** 可选封面图，放在 public/ 或直接用外链 */
    cover: z.string().optional(),
    /** 可选：覆盖自动计算出的标题锚点 */
    subtitle: z.string().optional(),
  }),
});

export const collections = { blog };
