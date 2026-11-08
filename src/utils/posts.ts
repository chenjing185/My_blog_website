import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/** 是否在 dev 环境（草稿仅在 dev 下可见） */
export const isDev = import.meta.env.DEV;

/**
 * 任意名称 → URL slug：保留字母/数字/中文，空格转连字符。
 * 中文标签也能得到干净 URL，避免百分号编码在不同托管平台上的差异。
 */
export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-');
}

/** 标签 / 分类共用同一套 slug 规则 */
export const tagSlug = toSlug;
export const categorySlug = toSlug;
export const seriesSlug = toSlug;

/** 取所有可见文章：生产环境过滤 draft，按发布日期倒序 */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => isDev || !data.draft);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** 列表排序：置顶优先，其余按时间倒序 */
export function sortForList(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  });
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
    .map(([year, list]) => ({ year, posts: list }));
}

export interface MonthGroup {
  month: number;
  posts: Post[];
}

/** 归档用：年份 → 月份 → 文章 */
export function groupByMonth(posts: Post[]): { year: number; months: MonthGroup[] }[] {
  const byYear = groupByYear(posts);
  return byYear.map(({ year, posts: list }) => {
    const map = new Map<number, Post[]>();
    for (const post of list) {
      const month = post.data.pubDate.getUTCMonth() + 1;
      const bucket = map.get(month) ?? [];
      bucket.push(post);
      map.set(month, bucket);
    }
    const months = [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([month, posts]) => ({ month, posts }));
    return { year, months };
  });
}

export interface TermEntry {
  slug: string;
  label: string;
  count: number;
}

function collectTerms(posts: Post[], pick: (post: Post) => string[]): TermEntry[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const post of posts) {
    for (const term of pick(post)) {
      const slug = toSlug(term);
      if (!slug) continue;
      const hit = map.get(slug);
      map.set(slug, { label: hit?.label ?? term, count: (hit?.count ?? 0) + 1 });
    }
  }
  return [...map.entries()]
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

/** 标签聚合，按文章数倒序、同数按拼音/字母序 */
export function collectTags(posts: Post[]): TermEntry[] {
  return collectTerms(posts, (post) => post.data.tags);
}

/** 分类聚合 */
export function collectCategories(posts: Post[]): TermEntry[] {
  return collectTerms(posts, (post) => (post.data.category ? [post.data.category] : []));
}

export interface SeriesEntry {
  slug: string;
  label: string;
  /** 按发布时间正序，即阅读顺序 */
  posts: Post[];
}

/** 专栏聚合：同一 series 的文章按时间正序排列 */
export function collectSeries(posts: Post[]): SeriesEntry[] {
  const map = new Map<string, { label: string; posts: Post[] }>();
  for (const post of posts) {
    const name = post.data.series;
    if (!name) continue;
    const slug = toSlug(name);
    if (!slug) continue;
    const hit = map.get(slug) ?? { label: name, posts: [] };
    hit.posts.push(post);
    map.set(slug, hit);
  }
  return [...map.entries()]
    .map(([slug, v]) => ({
      slug,
      label: v.label,
      posts: v.posts.sort((a, b) => a.data.pubDate.valueOf() - b.data.pubDate.valueOf()),
    }))
    // 最近有更新的专栏排前面
    .sort((a, b) => {
      const last = (s: SeriesEntry) => s.posts[s.posts.length - 1]?.data.pubDate.valueOf() ?? 0;
      return last(b) - last(a);
    });
}

export interface SeriesContext {
  slug: string;
  label: string;
  index: number;
  total: number;
  prev?: Post;
  next?: Post;
}

/** 当前文章所属专栏及其上下文 */
export function seriesContext(posts: Post[], current: Post): SeriesContext | undefined {
  const name = current.data.series;
  if (!name) return undefined;
  const slug = toSlug(name);
  const series = collectSeries(posts).find((s) => s.slug === slug);
  if (!series) return undefined;

  const index = series.posts.findIndex((p) => p.id === current.id);
  if (index < 0) return undefined;

  return {
    slug,
    label: series.label,
    index: index + 1,
    total: series.posts.length,
    prev: index > 0 ? series.posts[index - 1] : undefined,
    next: index < series.posts.length - 1 ? series.posts[index + 1] : undefined,
  };
}

/** 相关文章：标签重合度优先，同分类加分，最后按时间兜底 */
export function relatedPosts(posts: Post[], current: Post, limit = 3): Post[] {
  const tags = new Set(current.data.tags);

  const scored = posts
    .filter((p) => p.id !== current.id)
    .map((post) => {
      let score = post.data.tags.filter((t) => tags.has(t)).length * 2;
      if (current.data.category && post.data.category === current.data.category) score += 1;
      if (current.data.series && post.data.series === current.data.series) score -= 3;
      return { post, score };
    })
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf()
    );

  return scored.slice(0, limit).map((r) => r.post);
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

/** 外链文章直接跳外链，普通文章跳内部详情页 */
export function entryUrl(post: Post): string {
  return post.data.link ?? postUrl(post);
}

/** 是否外链文章 */
export function isExternalPost(post: Post): boolean {
  return Boolean(post.data.link);
}
