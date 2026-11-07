import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/** 是否在 dev 环境（草稿仅在 dev 下可见） */
export const isDev = import.meta.env.DEV;

/** 取所有可见文章：生产环境过滤 draft，按发布日期倒序 */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => isDev || !data.draft);
  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );
}

/** 按年份分组：[{ year: 2026, posts: [...] }] */
export function groupByYear(posts: Post[]): { year: number; posts: Post[] }[] {
  const map = new Map<number, Post[]>();
  for (const post of posts) {
    const year = post.data.pubDate.getUTCFullYear();
    const list = map.get(year) ?? [];
    list.push(post);
    map.set(year, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, posts]) => ({ year, posts }));
}

/**
 * 标签 slug：保留字母/数字/中文，空格转连字符
 * 中文标签也能得到干净的 URL，避免百分号编码在不同托管平台上的差异
 */
export function tagSlug(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-');
}

export interface TagEntry {
  slug: string;
  label: string;
  count: number;
}

/** 标签聚合，按文章数倒序、同数按拼音/字母序 */
export function collectTags(posts: Post[]): TagEntry[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
      if (!slug) continue;
      const hit = map.get(slug);
      map.set(slug, { label: hit?.label ?? tag, count: (hit?.count ?? 0) + 1 });
    }
  }
  return [...map.entries()]
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

/** 上一篇 / 下一篇（按时间正序的相邻关系） */
export function getNeighbors(posts: Post[], current: Post) {
  const sorted = [...posts].sort(
    (a, b) => a.data.pubDate.valueOf() - b.data.pubDate.valueOf()
  );
  const i = sorted.findIndex((p) => p.id === current.id);
  return {
    prev: i > 0 ? sorted[i - 1] : undefined,
    next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : undefined,
  };
}

/** 文章永久链接（与 trailingSlash: 'always' 保持一致） */
export function postUrl(post: Post): string {
  return `/blog/${post.id}/`;
}
