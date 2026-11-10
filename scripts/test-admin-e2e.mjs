/**
 * 写作台端到端测试（node:test）：mock 客户端全流程 + createGitHubClient 的请求级验证。
 *
 * - mock.js：新建 / 列表 / 读取 / 无 sha 更新（422）/ 过期 sha（409）/ 正常更新 / 删除 / 图片上传
 * - github.js：注入 fetchImpl，断言请求头、URL 编码、PUT body 的 base64、
 *              以及 401/403/404/409/422/5xx/网络异常都转成带中文提示的 GitHubError
 *
 * 运行（在仓库根目录）：
 *   node --test scripts/test-admin-lib.mjs scripts/test-admin-e2e.mjs
 *
 * 本文件不依赖任何第三方包，不联网，也不修改 src/。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createGitHubClient,
  GitHubError,
  encodeBase64,
  decodeBase64,
  encodePath,
} from '../src/scripts/admin/lib/github.js';
import { createMockClient, createDemoClient, DEMO_FILES } from '../src/scripts/admin/lib/mock.js';
import { parsePost, serializePost, splitFrontmatter } from '../src/scripts/admin/lib/frontmatter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.resolve(HERE, '../src/content/blog');

/**
 * 生成一个假的 fetch，用来在 Node 里模拟 GitHub REST API。
 * plan(index, url, init) 返回 { status?, body?, raw?, thrown?, ok?, rateLimit? }
 */
function makeFetch(plan) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = plan(calls.length - 1, url, init) || {};
    if (reply.thrown) throw reply.thrown;
    const status = reply.status === undefined ? 200 : reply.status;
    return {
      ok: reply.ok === undefined ? status < 400 : reply.ok,
      status,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          if (key === 'x-ratelimit-remaining') return reply.rateLimit === undefined ? '4999' : reply.rateLimit;
          return null;
        },
      },
      async text() {
        if (reply.raw !== undefined) return reply.raw;
        return reply.body === undefined ? '' : JSON.stringify(reply.body);
      },
    };
  };
  impl.calls = calls;
  return impl;
}

const TOKEN = 'ghp_test_token_123';

function makeClient(plan, extra = {}) {
  const fetchImpl = makeFetch(plan);
  const client = createGitHubClient(Object.assign({ token: TOKEN, owner: 'chenjing185', repo: 'My_blog_website', fetchImpl }, extra));
  return { client, fetchImpl };
}

/** 读回 PUT/DELETE 请求的 JSON body */
function bodyOf(call) {
  return JSON.parse(call.init.body);
}

// ---------------------------------------------------------------------------
// 1. GitHub 客户端：请求构造
// ---------------------------------------------------------------------------
describe('GitHub 客户端：请求构造', () => {
  it('GET /user 带正确的鉴权头与 API 版本', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: { login: 'chenjing185', name: '鲸鱼娘', avatar_url: 'https://x/a.png' } }));
    const user = await client.getUser();
    assert.equal(fetchImpl.calls.length, 1);
    const call = fetchImpl.calls[0];
    assert.equal(call.url, 'https://api.github.com/user');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(call.init.headers.Accept, 'application/vnd.github+json');
    assert.equal(call.init.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(call.init.body, undefined, 'GET 不应带 body');
    assert.deepEqual(user, { login: 'chenjing185', name: '鲸鱼娘', avatarUrl: 'https://x/a.png' });
  });

  it('name 缺失时回退到 login', async () => {
    const { client } = makeClient(() => ({ body: { login: 'u1' } }));
    assert.deepEqual(await client.getUser(), { login: 'u1', name: 'u1', avatarUrl: undefined });
  });

  it('getRepo 返回默认分支与是否私有', async () => {
    const { client, fetchImpl } = makeClient(() => ({
      body: { full_name: 'chenjing185/My_blog_website', default_branch: 'main', private: true, html_url: 'https://github.com/x/y' },
    }));
    const repo = await client.getRepo();
    assert.equal(fetchImpl.calls[0].url, 'https://api.github.com/repos/chenjing185/My_blog_website');
    assert.deepEqual(repo, {
      fullName: 'chenjing185/My_blog_website',
      defaultBranch: 'main',
      private: true,
      htmlUrl: 'https://github.com/x/y',
    });
  });

  it('listFiles 只留 .md/.mdx、按名字排序、带 ref 参数', async () => {
    const { client, fetchImpl } = makeClient(() => ({
      body: [
        { type: 'file', name: 'b.md', path: 'dir/b.md', sha: 'sb', size: 2 },
        { type: 'file', name: 'a.md', path: 'dir/a.md', sha: 'sa', size: 1 },
        { type: 'file', name: 'img.png', path: 'dir/img.png', sha: 'si', size: 3 },
        { type: 'dir', name: 'sub', path: 'dir/sub', sha: 'ss', size: 0 },
        { type: 'file', name: 'c.mdx', path: 'dir/c.mdx', sha: 'sc', size: 4 },
      ],
    }));
    const files = await client.listFiles('src/content/blog');
    assert.equal(fetchImpl.calls[0].url, 'https://api.github.com/repos/chenjing185/My_blog_website/contents/src/content/blog?ref=main');
    assert.deepEqual(files.map((file) => file.name), ['a.md', 'b.md', 'c.mdx']);
    assert.deepEqual(files[0], { name: 'a.md', path: 'dir/a.md', sha: 'sa', size: 1 });
  });

  it('listFiles 遇到不是数组的响应会抛中文错误', async () => {
    const { client } = makeClient(() => ({ body: { message: 'Not Found' } }));
    await assert.rejects(
      () => client.listFiles('src/content/blog'),
      (error) => {
        assert.ok(error instanceof GitHubError);
        assert.equal(error.status, 404);
        assert.equal(error.message, '文章目录不是一个文件夹，请检查路径设置');
        return true;
      },
    );
  });

  it('getFile 把 GitHub 带换行的 base64 解回中文', async () => {
    const text = '---\ntitle: 中文标题\n---\n\n正文 🚀\n';
    const wrapped = encodeBase64(text).replace(/(.{16})/g, (chunk) => chunk + '\n');
    const { client, fetchImpl } = makeClient(() => ({ body: { path: 'd/a.md', sha: 'sha1', size: 40, content: wrapped } }));
    const file = await client.getFile('d/a.md');
    assert.equal(fetchImpl.calls[0].url, 'https://api.github.com/repos/chenjing185/My_blog_website/contents/d/a.md?ref=main');
    assert.deepEqual(file, { path: 'd/a.md', sha: 'sha1', size: 40, text });
  });

  it('getFile 遇到目录响应会抛中文错误', async () => {
    const { client } = makeClient(() => ({ body: [{ type: 'file', name: 'a.md' }] }));
    await assert.rejects(
      () => client.getFile('dir'),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.message, '这是一个目录，不是文件');
        return true;
      },
    );
  });

  it('getFile 遇到超过 1 MB 的文件会抛中文错误', async () => {
    const { client } = makeClient(() => ({ body: { path: 'big.md', sha: 's', size: 2000000 } }));
    await assert.rejects(
      () => client.getFile('big.md'),
      (error) => {
        assert.equal(error.status, 413);
        assert.equal(error.message, '文件超过 1 MB，写作台暂不支持直接编辑');
        return true;
      },
    );
  });

  it('putFile 的 PUT body 里 base64 能解回中文，且带 branch', async () => {
    const text = '---\ntitle: 新文章 🐳\n---\n\n正文内容\n';
    const { client, fetchImpl } = makeClient(() => ({
      body: { content: { sha: 'newsha' }, commit: { sha: 'commit1', html_url: 'https://github.com/x/y/commit/1' } },
    }));
    const result = await client.putFile('src/content/blog/new-post.md', text, { message: 'post: 新增文章' });
    assert.equal(fetchImpl.calls.length, 1);
    const call = fetchImpl.calls[0];
    assert.equal(call.init.method, 'PUT');
    assert.equal(call.url, 'https://api.github.com/repos/chenjing185/My_blog_website/contents/src/content/blog/new-post.md');
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    const body = bodyOf(call);
    assert.deepEqual(Object.keys(body).sort(), ['branch', 'content', 'message']);
    assert.equal(body.branch, 'main');
    assert.equal(body.message, 'post: 新增文章');
    assert.equal(decodeBase64(body.content), text);
    assert.ok(!body.content.includes('\n'), 'base64 里不应有换行');
    assert.deepEqual(result, { sha: 'newsha', commitSha: 'commit1', commitUrl: 'https://github.com/x/y/commit/1' });
  });

  it('putFile 不给 message 时用默认文案，带 sha 时 body 里包含 sha', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: { content: { sha: 's2' } } }));
    await client.putFile('a.md', 'x', { sha: 'oldsha' });
    const body = bodyOf(fetchImpl.calls[0]);
    assert.equal(body.message, 'post: 更新文章');
    assert.equal(body.sha, 'oldsha');
  });

  it('putFile 对中文与空格路径逐段编码', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: {} }));
    await client.putFile('src/content/中文 名.md', 'x');
    assert.equal(
      fetchImpl.calls[0].url,
      'https://api.github.com/repos/chenjing185/My_blog_website/contents/src/content/%E4%B8%AD%E6%96%87%20%E5%90%8D.md',
    );
  });

  it('deleteFile 没有 sha 时直接抛错，一个请求都不发', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: {} }));
    await assert.rejects(
      () => client.deleteFile('a.md'),
      (error) => {
        assert.ok(error instanceof GitHubError);
        assert.equal(error.status, 400);
        assert.equal(error.message, '缺少文件版本号（sha），无法安全删除');
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('deleteFile 用 DELETE 并带上 sha / branch', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: { commit: { sha: 'c9', html_url: '' } } }));
    const result = await client.deleteFile('a.md', { sha: 's1', message: '删掉' });
    const call = fetchImpl.calls[0];
    assert.equal(call.init.method, 'DELETE');
    assert.deepEqual(bodyOf(call), { message: '删掉', sha: 's1', branch: 'main' });
    assert.deepEqual(result, { commitSha: 'c9', commitUrl: '' });
  });

  it('putBinary 会去掉 data: 前缀并保留二进制 base64', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: { content: { sha: 'imgsha' } } }));
    const result = await client.putBinary('public/img/a.png', 'data:image/png;base64,AAAA', { message: 'assets: 图' });
    const call = fetchImpl.calls[0];
    const body = bodyOf(call);
    assert.equal(body.content, 'AAAA');
    assert.equal(body.message, 'assets: 图');
    assert.equal(call.url, 'https://api.github.com/repos/chenjing185/My_blog_website/contents/public/img/a.png');
    assert.equal(result.sha, 'imgsha');
  });

  it('自定义 baseUrl / branch 生效', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: [] }), {
      baseUrl: 'https://ghe.example.com/api/v3',
      branch: 'draft',
    });
    await client.listFiles('d');
    assert.equal(fetchImpl.calls[0].url, 'https://ghe.example.com/api/v3/repos/chenjing185/My_blog_website/contents/d?ref=draft');
    assert.equal(client.branch, 'draft');
    assert.equal(client.isDemo, false);
  });

  it('缺少 token / 缺少 owner repo 时构造即报错', () => {
    assert.throws(() => createGitHubClient({ owner: 'o', repo: 'r' }), /缺少访问令牌/);
    assert.throws(() => createGitHubClient({ token: 't' }), /缺少仓库信息/);
    assert.throws(() => createGitHubClient({ token: 't', owner: 'o' }), /缺少仓库信息/);
  });
});

// ---------------------------------------------------------------------------
// 2. GitHub 客户端：错误处理
// ---------------------------------------------------------------------------
describe('GitHub 客户端：错误处理', () => {
  const cases = [
    { status: 401, body: { message: 'Bad credentials' }, expect: '访问令牌无效或已过期，请到 GitHub 重新生成' },
    { status: 403, body: { message: 'Resource not accessible by personal access token' }, expect: '这个令牌没有写入权限：需要 Contents 的 Read and write' },
    { status: 403, body: { message: 'API rate limit exceeded for 1.2.3.4' }, expect: 'GitHub API 请求太频繁，请等几分钟再试' },
    { status: 404, body: { message: 'Not Found' }, expect: '找不到仓库、分支或文件，也可能是令牌没有该仓库的访问权限' },
    { status: 409, body: { message: 'sha does not match' }, expect: '文件在别处被修改过（版本冲突），需要先同步' },
    { status: 422, body: { message: 'sha does not match' }, expect: '提交被 GitHub 拒绝：sha does not match' },
    { status: 500, body: { message: 'Internal Server Error' }, expect: 'GitHub 服务暂时不可用，请稍后重试' },
    { status: 502, raw: '<html>Bad Gateway</html>', expect: 'GitHub 服务暂时不可用，请稍后重试' },
    { status: 418, body: {}, expect: '请求失败（HTTP 418）' },
  ];

  for (const item of cases) {
    it('HTTP ' + item.status + ' → ' + item.expect, async () => {
      const { client } = makeClient(() => ({ status: item.status, body: item.body, raw: item.raw }));
      await assert.rejects(
        () => client.getUser(),
        (error) => {
          assert.ok(error instanceof GitHubError, '应该是 GitHubError');
          assert.equal(error.name, 'GitHubError');
          assert.equal(error.status, item.status);
          assert.equal(error.message, item.expect);
          assert.equal(error.rateLimit, '4999');
          return true;
        },
      );
    });
  }

  it('响应体为空时也能给出中文错误', async () => {
    const { client } = makeClient(() => ({ status: 404, raw: '' }));
    await assert.rejects(
      () => client.getFile('a.md'),
      (error) => {
        assert.equal(error.status, 404);
        assert.equal(error.message, '找不到仓库、分支或文件，也可能是令牌没有该仓库的访问权限');
        return true;
      },
    );
  });

  it('网络异常转成 status 0 的 GitHubError，提示中文', async () => {
    const { client } = makeClient(() => ({ thrown: new TypeError('fetch failed') }));
    await assert.rejects(
      () => client.listFiles('src/content/blog'),
      (error) => {
        assert.ok(error instanceof GitHubError);
        assert.equal(error.status, 0);
        assert.equal(error.message, '网络请求失败：检查手机网络或代理设置');
        assert.ok(error.data instanceof TypeError);
        return true;
      },
    );
  });

  it('429 之类未单独处理的 4xx 带状态码', async () => {
    const { client } = makeClient(() => ({ status: 429, body: { message: 'slow down' } }));
    await assert.rejects(
      () => client.putFile('a.md', 'x'),
      (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.message, '请求失败（HTTP 429）：slow down');
        return true;
      },
    );
  });

  it('GitHubError 默认字段', () => {
    const error = new GitHubError('自定义');
    assert.equal(error.name, 'GitHubError');
    assert.equal(error.status, 0);
    assert.equal(error.data, undefined);
    assert.ok(error instanceof Error);
  });
});

// ---------------------------------------------------------------------------
// 3. GitHub 客户端：编码工具
// ---------------------------------------------------------------------------
describe('GitHub 客户端：编码工具', () => {
  it('中文 / emoji base64 往返', () => {
    for (const text of ['中文内容', '标题：中文 ✓', '🚀🐳 emoji', '']) {
      assert.equal(decodeBase64(encodeBase64(text)), text);
    }
  });

  it('长文本（超过 0x8000 分块）往返不丢字节', () => {
    const long = '写作台'.repeat(10000);
    assert.equal(decodeBase64(encodeBase64(long)), long);
  });

  it('decodeBase64 容忍 GitHub 返回的换行', () => {
    const raw = encodeBase64('中文');
    const withNewlines = raw.slice(0, 4) + '\n' + raw.slice(4) + '\r\n';
    assert.equal(decodeBase64(withNewlines), '中文');
  });

  it('encodePath 逐段编码，斜杠保留', () => {
    assert.equal(encodePath('src/content/blog/a.md'), 'src/content/blog/a.md');
    assert.equal(encodePath('src/content/中文 名.md'), 'src/content/%E4%B8%AD%E6%96%87%20%E5%90%8D.md');
    assert.equal(encodePath('a b/c#d.md'), 'a%20b/c%23d.md');
  });
});

// ---------------------------------------------------------------------------
// 4. mock 客户端：端到端流程
// ---------------------------------------------------------------------------
describe('mock 客户端：文章全流程', () => {
  const DIR = 'src/content/blog';
  const NEW_PATH = DIR + '/new-post.md';
  const SOURCE = '---\ntitle: 新文章\ndescription: 摘要\npubDate: 2026-11-10\ntags: [随笔]\n---\n\n## 小标题\n\n正文内容\n';

  it('创建 → 列表 → 读取', async () => {
    const client = createMockClient({ dir: DIR });
    assert.equal(client.isDemo, true);

    const created = await client.putFile(NEW_PATH, SOURCE, { message: 'post: 新增文章' });
    assert.match(created.sha, /^[0-9a-f]{8}$/);
    assert.equal(created.sha, created.commitSha);
    assert.ok(created.commitUrl.startsWith('https://github.com/'));

    const files = await client.listFiles();
    assert.equal(files.length, 1);
    assert.deepEqual(Object.keys(files[0]).sort(), ['name', 'path', 'sha', 'size']);
    assert.equal(files[0].name, 'new-post.md');
    assert.equal(files[0].path, NEW_PATH);
    assert.equal(files[0].sha, created.sha);
    assert.equal(files[0].size, Buffer.byteLength(SOURCE, 'utf8'));

    const file = await client.getFile(NEW_PATH);
    assert.equal(file.path, NEW_PATH);
    assert.equal(file.sha, created.sha);
    assert.equal(file.text, SOURCE);
    // size 统一按 UTF-8 字节算，和 listFiles 保持一致（中文不能按字符数）
    assert.equal(file.size, Buffer.byteLength(SOURCE, 'utf8'));
    assert.equal(file.size, files[0].size);
  });

  it('更新必须带 sha：不带 sha 报 422', async () => {
    const client = createMockClient({ dir: DIR, files: { [NEW_PATH]: SOURCE } });
    await assert.rejects(
      () => client.putFile(NEW_PATH, '改过的内容'),
      (error) => {
        assert.ok(error instanceof GitHubError);
        assert.equal(error.status, 422);
        assert.equal(error.message, '文件已存在，更新必须带 sha');
        return true;
      },
    );
  });

  it('过期 sha 报 409（版本冲突）', async () => {
    const client = createMockClient({ dir: DIR, files: { [NEW_PATH]: SOURCE } });
    await assert.rejects(
      () => client.putFile(NEW_PATH, '改过的内容', { sha: 'deadbeef' }),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.message, 'sha 不匹配（版本冲突）');
        return true;
      },
    );
  });

  it('带正确 sha 的更新成功，sha 变化、内容更新', async () => {
    const client = createMockClient({ dir: DIR, files: { [NEW_PATH]: SOURCE } });
    const before = await client.getFile(NEW_PATH);
    const updated = await client.putFile(NEW_PATH, SOURCE + '\n新增一行\n', { sha: before.sha, message: 'post: 更新' });
    assert.notEqual(updated.sha, before.sha);
    const after = await client.getFile(NEW_PATH);
    assert.equal(after.sha, updated.sha);
    assert.ok(after.text.endsWith('新增一行\n'));
    // 旧 sha 立刻失效
    await assert.rejects(
      () => client.putFile(NEW_PATH, '再改', { sha: before.sha }),
      (error) => error.status === 409,
    );
  });

  it('给不存在的文件带 sha 更新报 404', async () => {
    const client = createMockClient({ dir: DIR });
    await assert.rejects(
      () => client.putFile(NEW_PATH, 'x', { sha: 'abc12345' }),
      (error) => error.status === 404 && error.message === '文件不存在，无法更新',
    );
  });

  it('删除：带 sha 成功，删掉后读取报 404；sha 不对报 409', async () => {
    const client = createMockClient({ dir: DIR, files: { [NEW_PATH]: SOURCE } });
    const file = await client.getFile(NEW_PATH);

    await assert.rejects(
      () => client.deleteFile(NEW_PATH, { sha: 'wrongsha' }),
      (error) => error.status === 409,
    );

    const deleted = await client.deleteFile(NEW_PATH, { sha: file.sha });
    assert.match(deleted.commitSha, /^[0-9a-f]{8}$/);
    assert.equal(client._peek(NEW_PATH), null);

    await assert.rejects(
      () => client.getFile(NEW_PATH),
      (error) => error.status === 404 && error.message === '找不到文件',
    );
    await assert.rejects(
      () => client.deleteFile(NEW_PATH, { sha: file.sha }),
      (error) => error.status === 404,
    );
  });

  it('列表只收当前目录的 .md/.mdx，忽略子目录与其他文件', async () => {
    const client = createMockClient({
      dir: DIR,
      files: {
        'src/content/blog/a.md': 'a',
        'src/content/blog/b.mdx': 'b',
        'src/content/blog/sub/c.md': 'c',
        'src/content/blog/img.png': 'd',
        'other/e.md': 'e',
      },
    });
    assert.deepEqual((await client.listFiles()).map((file) => file.name), ['a.md', 'b.mdx']);
  });

  it('图片二进制上传：剥离 data: 前缀、sha 变化、过期 sha 冲突', async () => {
    const client = createMockClient({ dir: DIR });
    const path = 'public/img/photo.png';
    const base64 = 'iVBORw0KGgoAAAANSUhEUg==';

    const first = await client.putBinary(path, 'data:image/png;base64,' + base64, {});
    assert.match(first.sha, /^[0-9a-f]{8}$/);
    assert.deepEqual(client._peek(path), { base64, sha: first.sha });
    assert.equal((await client.getFile(path)).text, decodeBase64(base64));

    await assert.rejects(
      () => client.putBinary(path, base64, { sha: 'stale00' }),
      (error) => error.status === 409,
    );

    const second = await client.putBinary(path, base64, { sha: first.sha });
    assert.notEqual(second.sha, first.sha);
    assert.equal(client._peek(path).sha, second.sha);
  });

  it('getUser / getRepo 返回演示数据', async () => {
    const client = createMockClient({ owner: 'o', repo: 'r' });
    assert.deepEqual(await client.getUser(), { login: 'demo-user', name: '演示账号', avatarUrl: '' });
    assert.deepEqual(await client.getRepo(), {
      fullName: 'o/r',
      defaultBranch: 'main',
      private: false,
      htmlUrl: 'https://github.com/o/r',
    });
  });
});

describe('mock 客户端：演示数据与真实文章联动', () => {
  it('createDemoClient 预置两篇，其中一篇是草稿', async () => {
    const client = createDemoClient();
    assert.equal(client.isDemo, true);
    const files = await client.listFiles();
    assert.deepEqual(files.map((file) => file.name), ['demo-draft.md', 'demo-hello.md']);

    const draft = parsePost((await client.getFile('src/content/blog/demo-draft.md')).text);
    assert.equal(draft.frontmatter.draft, true);
    assert.equal(draft.frontmatter.title, '演示草稿');

    const hello = parsePost((await client.getFile('src/content/blog/demo-hello.md')).text);
    assert.equal(hello.frontmatter.pinned, true);
    assert.deepEqual(hello.frontmatter.tags, ['随笔', 'Astro']);
    assert.equal(Object.keys(DEMO_FILES).length, 2);
  });

  it('真实文章写入 mock 后读回，parse 结果一致', async () => {
    const name = 'hello-world.md';
    const source = fs.readFileSync(path.join(BLOG_DIR, name), 'utf8');
    const parsed = parsePost(source);
    const client = createMockClient({ dir: 'src/content/blog' });
    const targetPath = 'src/content/blog/' + name;

    const created = await client.putFile(targetPath, source, { message: 'post: 导入' });
    const back = await client.getFile(targetPath);
    assert.equal(back.sha, created.sha);
    const reparsed = parsePost(back.text);
    assert.equal(reparsed.frontmatter.title, parsed.frontmatter.title);
    assert.equal(reparsed.body.trim(), parsed.body.trim());
  });

  it('在 mock 上完整走一遍「改标题 → 保存 → 读回」', async () => {
    const source = fs.readFileSync(path.join(BLOG_DIR, 'draft-demo.md'), 'utf8');
    const client = createMockClient({ dir: 'src/content/blog' });
    const targetPath = 'src/content/blog/draft-demo.md';
    await client.putFile(targetPath, source, {});

    const current = parsePost((await client.getFile(targetPath)).text);
    const updated = Object.assign({}, current, {
      frontmatter: Object.assign({}, current.frontmatter, { title: '改过的标题：带冒号', draft: false }),
    });
    const nextSource = serializePost(updated);
    const saved = await client.putFile(targetPath, nextSource, { sha: (await client.getFile(targetPath)).sha });

    const reloaded = parsePost((await client.getFile(targetPath)).text);
    assert.equal(reloaded.frontmatter.title, '改过的标题：带冒号');
    assert.equal(reloaded.frontmatter.draft, undefined, 'draft: false 不应写进文件');
    // 正文里本来就有「draft: true」这几个字（文章在讲草稿机制），所以只检查 frontmatter 块
    assert.ok(!splitFrontmatter(nextSource).frontmatter.includes('draft:'));
    assert.ok(nextSource.includes('draft: true'), '正文里的示例文字不应被改动');
    assert.equal((await client.getFile(targetPath)).sha, saved.sha);
  });
});
