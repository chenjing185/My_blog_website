/**
 * 写作台的"假 GitHub"，只用于两件事：
 * 1. 页面 ?demo=1 演示模式（不联网、不写入仓库）；
 * 2. Node 端端到端测试（覆盖新增/保存/冲突/删除/图片上传）。
 */

import { GitHubError, encodeBase64, decodeBase64 } from './github.js';

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {{owner?:string, repo?:string, branch?:string, dir?:string, files?:Record<string,string>}} options
 */
export function createMockClient(options = {}) {
  const {
    owner = 'chenjing185',
    repo = 'My_blog_website',
    branch = 'main',
    dir = 'src/content/blog',
    files = {},
  } = options;

  /** path -> { text?: string, base64?: string } */
  const store = new Map();
  for (const [path, text] of Object.entries(files)) {
    store.set(path, { text, sha: simpleHash(text) });
  }

  function current(path) {
    return store.get(path) ?? null;
  }

  return {
    owner,
    repo,
    branch,
    isDemo: true,

    async getUser() {
      return { login: 'demo-user', name: '演示账号', avatarUrl: '' };
    },

    async getRepo() {
      return { fullName: `${owner}/${repo}`, defaultBranch: branch, private: false, htmlUrl: `https://github.com/${owner}/${repo}` };
    },

    async listFiles(folder = dir) {
      return [...store.keys()]
        .filter((path) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/') && /\.mdx?$/i.test(path))
        .map((path) => {
          const file = store.get(path);
          const text = file.text ?? '';
          return { name: path.slice(folder.length + 1), path, sha: file.sha, size: new TextEncoder().encode(text).length };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getFile(path) {
      const file = current(path);
      if (!file) throw new GitHubError('找不到文件', { status: 404 });
      if (file.base64 !== undefined) return { path, sha: file.sha, size: 0, text: decodeBase64(file.base64) };
      const bytes = new TextEncoder().encode(file.text ?? '').length;
      return { path, sha: file.sha, size: bytes, text: file.text };
    },

    async putFile(path, text, { message, sha } = {}) {
      const file = current(path);
      if (file && !sha) throw new GitHubError('文件已存在，更新必须带 sha', { status: 422 });
      if (!file && sha) throw new GitHubError('文件不存在，无法更新', { status: 404 });
      if (file && sha !== file.sha) throw new GitHubError('sha 不匹配（版本冲突）', { status: 409 });
      const nextSha = simpleHash(`${text}:${Date.now()}:${Math.random()}`);
      store.set(path, { text, sha: nextSha });
      return { sha: nextSha, commitSha: nextSha, commitUrl: `https://github.com/${owner}/${repo}/commit/${nextSha}`, message };
    },

    async deleteFile(path, { sha } = {}) {
      const file = current(path);
      if (!file) throw new GitHubError('找不到文件', { status: 404 });
      if (file.sha !== sha) throw new GitHubError('sha 不匹配（版本冲突）', { status: 409 });
      store.delete(path);
      return { commitSha: simpleHash(path), commitUrl: '' };
    },

    async putBinary(path, base64, { sha } = {}) {
      const file = current(path);
      if (file && sha !== file.sha) throw new GitHubError('sha 不匹配（版本冲突）', { status: 409 });
      const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
      const nextSha = simpleHash(`${clean}:${Date.now()}:${Math.random()}`);
      store.set(path, { base64: clean, sha: nextSha });
      return { sha: nextSha, commitSha: nextSha, commitUrl: '' };
    },

    /** 测试用：直接读内存里的文件 */
    _peek(path) {
      return store.get(path) ?? null;
    },
  };
}

/** 演示模式预置的两篇文章 */
export const DEMO_FILES = {
  'src/content/blog/demo-hello.md': `---
title: 演示文章：在手机上写博客
description: 这是一篇演示数据，用来预览写作台。保存只发生在内存里，不会写入你的仓库。
pubDate: 2026-11-10
category: 随笔
tags: ['随笔', 'Astro']
pinned: true
---

写作台把文章直接提交到 GitHub，Netlify 收到推送后自动重新构建。

## 可以试试

- 点右上角「新建」写一篇
- 打开这篇文章改改标题
- 试试点工具栏里的「图片」

> 演示模式不会联网，也不会动你的仓库。
`,
  'src/content/blog/demo-draft.md': `---
title: 演示草稿
description: 草稿不会出现在生产构建里，可以放心先存着。
pubDate: 2026-11-09
tags: ['随笔']
draft: true
---

写完把「存为草稿」关掉，再保存，它就会发布。
`,
};

/** 演示客户端：打开 ?demo=1 时使用 */
export function createDemoClient() {
  return createMockClient({
    dir: 'src/content/blog',
    files: DEMO_FILES,
  });
}

export { encodeBase64 };
