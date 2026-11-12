/**
 * 写作台新增能力的测试：
 * - drafts.js：多槽位草稿（这是唯一会丢稿子的地方，测细一点）
 * - github.js：Git Data API 的多文件原子提交 / 递归列目录
 *
 * 运行（在仓库根目录）：
 *   npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAFT_LIMIT,
  DRAFT_TOTAL_BYTES,
  NEW_DRAFT_KEY,
  draftKeyForSlug,
  listDrafts,
  pickDraft,
  pruneDrafts,
  putDraft,
  readDrafts,
  removeDraft,
  snapshotBytes,
  snapshotFromSource,
} from '../src/scripts/admin/lib/drafts.js';
import { createGitHubClient, GitHubError } from '../src/scripts/admin/lib/github.js';
import { createMockClient } from '../src/scripts/admin/lib/mock.js';

const TOKEN = 'ghp_test_token';

function makeFetch(plan) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = plan(url, init, calls.length - 1) || {};
    if (reply.thrown) throw reply.thrown;
    const status = reply.status === undefined ? 200 : reply.status;
    return {
      ok: status < 400,
      status,
      headers: { get: () => '4999' },
      async text() {
        return reply.body === undefined ? '' : JSON.stringify(reply.body);
      },
    };
  };
  impl.calls = calls;
  return impl;
}

function makeClient(plan) {
  const fetchImpl = makeFetch(plan);
  const client = createGitHubClient({ token: TOKEN, owner: 'chenjing185', repo: 'My_blog_website', fetchImpl });
  return { client, fetchImpl };
}

function snapshot(title, overrides = {}) {
  return {
    title,
    description: '摘要',
    pubdate: '2026-11-12',
    tags: '',
    body: '正文',
    savedAt: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 多槽位草稿
// ---------------------------------------------------------------------------

describe('草稿：key 与槽位', () => {
  it('空 slug 落到「新文章」槽位，有 slug 就用自己的', () => {
    assert.equal(draftKeyForSlug(''), NEW_DRAFT_KEY);
    assert.equal(draftKeyForSlug(null), NEW_DRAFT_KEY);
    assert.equal(draftKeyForSlug('  '), NEW_DRAFT_KEY);
    assert.equal(draftKeyForSlug('my-post'), 'my-post');
  });

  it('两份互不覆盖（旧实现的核心 bug）', () => {
    let drafts = {};
    drafts = putDraft(drafts, 'post-a', snapshot('A', { body: 'A 的正文' }));
    drafts = putDraft(drafts, 'post-b', snapshot('B', { body: 'B 的正文' }));

    assert.equal(pickDraft(drafts, 'post-a').body, 'A 的正文');
    assert.equal(pickDraft(drafts, 'post-b').body, 'B 的正文');
    assert.equal(listDrafts(drafts).length, 2);
  });

  it('同一篇再存一次是覆盖，不是新增', () => {
    let drafts = putDraft({}, 'post-a', snapshot('旧标题'));
    drafts = putDraft(drafts, 'post-a', snapshot('新标题', { savedAt: 2000 }));
    assert.equal(listDrafts(drafts).length, 1);
    assert.equal(pickDraft(drafts, 'post-a').title, '新标题');
  });

  it('写入时补上 key 与 savedAt', () => {
    const drafts = putDraft({}, 'post-a', { title: 'A' });
    const saved = pickDraft(drafts, 'post-a');
    assert.equal(saved.key, 'post-a');
    assert.ok(saved.savedAt > 0);
  });

  it('removeDraft 只删指定槽位', () => {
    let drafts = putDraft(putDraft({}, 'a', snapshot('A')), 'b', snapshot('B'));
    drafts = removeDraft(drafts, 'a');
    assert.equal(pickDraft(drafts, 'a'), null);
    assert.equal(pickDraft(drafts, 'b').title, 'B');
    assert.deepEqual(removeDraft(drafts, '不存在的'), drafts);
  });

  it('pickDraft 对空值 / 未知 key 返回 null', () => {
    assert.equal(pickDraft({}, 'x'), null);
    assert.equal(pickDraft(null, 'x'), null);
  });
});

describe('草稿：列表与淘汰', () => {
  it('listDrafts 按保存时间倒序，并给出摘要字段', () => {
    let drafts = putDraft({}, 'a', snapshot('A', { savedAt: 100, body: '12345', isNew: false }));
    drafts = putDraft(drafts, 'b', snapshot('B', { savedAt: 300, isNew: true }));
    const list = listDrafts(drafts);

    assert.deepEqual(
      list.map((item) => item.key),
      ['b', 'a']
    );
    assert.equal(list[0].isNew, true);
    assert.equal(list[1].chars, 5);
    assert.equal(list[1].title, 'A');
  });

  it('没有标题时回退成（未命名）', () => {
    const list = listDrafts(putDraft({}, 'a', snapshot('', { title: '  ' })));
    assert.equal(list[0].title, '（未命名）');
  });

  it('不超过 DRAFT_LIMIT 份，超出淘汰最旧的', () => {
    let drafts = {};
    for (let i = 0; i < DRAFT_LIMIT + 5; i += 1) {
      drafts = putDraft(drafts, `post-${i}`, snapshot(`第 ${i} 篇`, { savedAt: 1000 + i }));
    }
    const list = listDrafts(drafts);
    assert.equal(list.length, DRAFT_LIMIT);
    assert.equal(list[0].key, `post-${DRAFT_LIMIT + 4}`);
    assert.equal(list.at(-1).key, 'post-5');
  });

  it('正文特别长时至少保留一份，不会把自己淘汰掉', () => {
    const huge = 'x'.repeat(DRAFT_TOTAL_BYTES + 1000);
    let drafts = putDraft({}, 'big', snapshot('长文', { body: huge, savedAt: 5000 }));
    assert.equal(listDrafts(drafts).length, 1);

    drafts = putDraft(drafts, 'small', snapshot('短文', { savedAt: 4000 }));
    assert.equal(listDrafts(drafts).length, 1, '超预算后不该再塞第二份');
    assert.equal(listDrafts(drafts)[0].key, 'big');
  });

  it('pruneDrafts 对空输入安全', () => {
    assert.deepEqual(pruneDrafts(null), {});
    assert.deepEqual(pruneDrafts({}), {});
  });

  it('snapshotBytes 给出正数', () => {
    assert.ok(snapshotBytes(snapshot('A')) > 0);
    assert.equal(snapshotBytes(null), 2); // "{}"
  });
});

describe('草稿：读取容错', () => {
  it('坏 JSON / null / 数组都读成空映射', () => {
    assert.deepEqual(readDrafts('{坏掉的'), {});
    assert.deepEqual(readDrafts(''), {});
    assert.deepEqual(readDrafts(null), {});
    assert.deepEqual(readDrafts('[]'), {});
    assert.deepEqual(readDrafts('[1,2]'), {});
  });

  it('跳过非对象的槽位', () => {
    const drafts = readDrafts(JSON.stringify({ a: { title: 'A' }, b: 'nope', c: null, d: [] }));
    assert.deepEqual(Object.keys(drafts), ['a']);
  });

  it('接受已解析好的对象', () => {
    assert.equal(readDrafts({ a: { title: 'A' } }).a.title, 'A');
  });
});

describe('草稿：从远端文本生成快照', () => {
  const source = [
    '---',
    'title: 远端版本',
    'description: 摘要',
    "pubDate: 2026-11-10",
    "updatedDate: 2026-11-11T09:30:00Z",
    'category: 随笔',
    "tags: ['随笔', '手机']",
    'series: 建站笔记',
    'draft: true',
    'pinned: true',
    'cover: /uploads/2026-11/a.jpg',
    '---',
    '',
    '正文第一段。',
  ].join('\n');

  it('把 frontmatter 摊平成表单字段', () => {
    const shot = snapshotFromSource('my-post', source);
    assert.equal(shot.key, 'my-post');
    assert.equal(shot.title, '远端版本');
    assert.equal(shot.pubdate, '2026-11-10');
    assert.equal(shot.updated, '2026-11-11');
    assert.equal(shot.category, '随笔');
    assert.equal(shot.tags, '随笔, 手机');
    assert.equal(shot.series, '建站笔记');
    assert.equal(shot.cover, '/uploads/2026-11/a.jpg');
    assert.equal(shot.draft, true);
    assert.equal(shot.pinned, true);
    assert.equal(shot.remoteBackup, false);
    assert.equal(shot.isNew, false);
    assert.ok(shot.body.startsWith('正文第一段。'));
  });

  it('可以标记成远端备份并覆盖标题', () => {
    const shot = snapshotFromSource('my-post', source, { title: '（远端版本）远端版本', remoteBackup: true });
    assert.equal(shot.remoteBackup, true);
    assert.equal(shot.title, '（远端版本）远端版本');
  });

  it('新文章槽位不写 slug，避免把 __new__ 当文件名', () => {
    const shot = snapshotFromSource(NEW_DRAFT_KEY, source);
    assert.equal(shot.slug, '');
  });
});

// ---------------------------------------------------------------------------
// 2. Git Data API
// ---------------------------------------------------------------------------

describe('GitHub：多文件原子提交', () => {
  function planFor(options = {}) {
    return (url, init = {}) => {
      if (url.endsWith('/git/ref/heads/main')) return { body: { object: { sha: 'parent-sha' } } };
      if (url.endsWith('/git/commits/parent-sha')) return { body: { sha: 'parent-sha', tree: { sha: 'base-tree' } } };
      if (url.endsWith('/git/blobs')) return { body: { sha: 'blob-sha' } };
      if (url.endsWith('/git/trees')) return { body: { sha: 'new-tree' } };
      if (url.endsWith('/git/commits') && init.method === 'POST') return { body: { sha: 'commit-1' } };
      if (url.endsWith('/git/refs/heads/main')) return { body: { object: { sha: 'commit-1' } } };
      return { body: {} };
    };
  }

  it('新增 + 删除合成一个 commit，顺序和 payload 都对', async () => {
    const { client, fetchImpl } = makeClient(planFor());
    const result = await client.commitFiles(
      [
        { path: 'src/content/blog/new-name.md', text: 'hello' },
        { path: 'src/content/blog/old-name.md', delete: true },
      ],
      { message: 'post: 重命名《标题》' }
    );

    assert.equal(result.commitSha, 'commit-1');
    assert.equal(result.commitUrl, 'https://github.com/chenjing185/My_blog_website/commit/commit-1');
    assert.equal(result.files, 2);

    const treeCall = fetchImpl.calls.find((call) => call.url.endsWith('/git/trees'));
    assert.equal(treeCall.init.method, 'POST');
    const treeBody = JSON.parse(treeCall.init.body);
    assert.equal(treeBody.base_tree, 'base-tree');
    assert.deepEqual(treeBody.tree[0], {
      path: 'src/content/blog/new-name.md',
      mode: '100644',
      type: 'blob',
      content: 'hello',
    });
    assert.deepEqual(treeBody.tree[1], {
      path: 'src/content/blog/old-name.md',
      mode: '100644',
      type: 'blob',
      sha: null,
    });

    const commitCall = fetchImpl.calls.find((call) => call.url.endsWith('/git/commits') && call.init.method === 'POST');
    const commitBody = JSON.parse(commitCall.init.body);
    assert.equal(commitBody.tree, 'new-tree');
    assert.deepEqual(commitBody.parents, ['parent-sha']);
    assert.equal(commitBody.message, 'post: 重命名《标题》');

    const patch = fetchImpl.calls.find((call) => call.url.endsWith('/git/refs/heads/main'));
    assert.equal(patch.init.method, 'PATCH');
    const patchBody = JSON.parse(patch.init.body);
    assert.equal(patchBody.sha, 'commit-1');
    assert.equal(patchBody.force, false, '绝不能强推，否则会盖掉别人的提交');
  });

  it('二进制文件先建 blob 再进 tree', async () => {
    const { client, fetchImpl } = makeClient(planFor());
    await client.commitFiles([{ path: 'public/uploads/2026-11/a.jpg', base64: 'data:image/jpeg;base64,QUJD' }]);

    const blobCall = fetchImpl.calls.find((call) => call.url.endsWith('/git/blobs'));
    const blobBody = JSON.parse(blobCall.init.body);
    assert.equal(blobBody.content, 'QUJD');
    assert.equal(blobBody.encoding, 'base64');

    const treeBody = JSON.parse(fetchImpl.calls.find((call) => call.url.endsWith('/git/trees')).init.body);
    assert.deepEqual(treeBody.tree[0], {
      path: 'public/uploads/2026-11/a.jpg',
      mode: '100644',
      type: 'blob',
      sha: 'blob-sha',
    });
  });

  it('没有改动时直接报错，一个请求都不发', async () => {
    const { client, fetchImpl } = makeClient(planFor());
    await assert.rejects(() => client.commitFiles([]), (error) => error instanceof GitHubError && error.status === 400);
    await assert.rejects(() => client.commitFiles([{ path: '' }]), GitHubError);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('分支被别处更新（not a fast forward）给出可操作的中文提示', async () => {
    const plan = (url) => {
      if (url.endsWith('/git/ref/heads/main')) return { body: { object: { sha: 'parent-sha' } } };
      if (url.endsWith('/git/commits/parent-sha')) return { body: { sha: 'parent-sha', tree: { sha: 'base-tree' } } };
      if (url.endsWith('/git/trees')) return { body: { sha: 'new-tree' } };
      if (url.endsWith('/git/commits')) return { body: { sha: 'commit-1' } };
      if (url.endsWith('/git/refs/heads/main')) {
        return { status: 422, body: { message: 'Update is not a fast forward' } };
      }
      return { body: {} };
    };
    const { client } = makeClient(plan);
    await assert.rejects(
      () => client.commitFiles([{ path: 'a.md', text: 'x' }]),
      /分支在你提交前又被更新了/
    );
  });
});

describe('GitHub：递归列目录', () => {
  const treeBody = {
    tree: [
      { path: 'public/uploads/2026-11/2-b.jpg', type: 'blob', size: 200, sha: 'b' },
      { path: 'public/uploads/2026-10/3-c.png', type: 'blob', size: 300, sha: 'c' },
      { path: 'public/uploads/2026-11/1-a.jpg', type: 'blob', size: 100, sha: 'a' },
      { path: 'public/uploads/2026-11', type: 'tree', sha: 'dir' },
      { path: 'src/content/blog/x.md', type: 'blob', size: 10, sha: 'd' },
    ],
  };

  it('只留目录下的 blob，路径倒序（新上传的在前）', async () => {
    const { client, fetchImpl } = makeClient(() => ({ body: treeBody }));
    const files = await client.listTree('public/uploads');

    assert.deepEqual(
      files.map((file) => file.path),
      ['public/uploads/2026-11/2-b.jpg', 'public/uploads/2026-11/1-a.jpg', 'public/uploads/2026-10/3-c.png']
    );
    assert.equal(files[0].name, '2026-11/2-b.jpg');
    assert.equal(files[0].size, 200);
    assert.ok(fetchImpl.calls[0].url.includes('recursive=1'));
  });

  it('目录末尾多写斜杠也能匹配', async () => {
    const { client } = makeClient(() => ({ body: treeBody }));
    assert.equal((await client.listTree('public/uploads/')).length, 3);
  });

  it('响应里没有 tree 时返回空数组', async () => {
    const { client } = makeClient(() => ({ body: {} }));
    assert.deepEqual(await client.listTree('public/uploads'), []);
  });
});

// ---------------------------------------------------------------------------
// 3. mock 客户端也要支持这些新方法（演示模式依赖它）
// ---------------------------------------------------------------------------

describe('mock：原子提交与列目录', () => {
  it('重命名：新文件出现、旧文件消失、只产生一个 commit', async () => {
    const client = createMockClient();
    await client.putFile('src/content/blog/old.md', 'old', {});
    const result = await client.commitFiles(
      [
        { path: 'src/content/blog/new.md', text: 'new' },
        { path: 'src/content/blog/old.md', delete: true },
      ],
      { message: 'post: 重命名' }
    );

    assert.equal(result.files, 2);
    assert.ok(result.commitSha);
    const files = await client.listFiles('src/content/blog');
    assert.deepEqual(files.map((file) => file.name), ['new.md']);
    assert.equal((await client.getFile('src/content/blog/new.md')).text, 'new');
  });

  it('删除不存在的文件会报 404，且不影响其他改动', async () => {
    const client = createMockClient();
    await client.putFile('src/content/blog/a.md', 'a', {});
    await assert.rejects(
      () =>
        client.commitFiles([
          { path: 'src/content/blog/a.md', text: '改了' },
          { path: 'src/content/blog/none.md', delete: true },
        ]),
      (error) => error.status === 404
    );
    assert.equal((await client.getFile('src/content/blog/a.md')).text, 'a', '失败的提交不该改到任何文件');
  });

  it('listTree 能列出嵌套目录里的图片', async () => {
    const client = createMockClient();
    await client.putBinary('public/uploads/2026-11/a.jpg', 'QUJD', {});
    await client.putBinary('public/uploads/2026-10/b.png', 'QUJD', {});

    const files = await client.listTree('public/uploads');
    assert.deepEqual(
      files.map((file) => file.path),
      ['public/uploads/2026-11/a.jpg', 'public/uploads/2026-10/b.png']
    );
    assert.ok(files[0].size > 0);
  });
});
