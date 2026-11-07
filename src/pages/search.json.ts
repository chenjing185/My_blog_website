import type { APIRoute } from 'astro';
import { getPosts, postUrl } from '../utils/posts';
import { stripMarkdown } from '../utils/format';

/**
 * 构建期生成的搜索索引，供 /search/ 页面前端读取。
 * 只取正文前 1200 字，控制体积（几十篇文章也就几百 KB）。
 */
export const GET: APIRoute = async () => {
  const posts = await getPosts();

  const index = posts.map((post) => ({
    title: post.data.title,
    description: post.data.description,
    tags: post.data.tags,
    date: post.data.pubDate.toISOString().slice(0, 10),
    url: postUrl(post),
    text: stripMarkdown(post.body).slice(0, 1200),
  }));

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
