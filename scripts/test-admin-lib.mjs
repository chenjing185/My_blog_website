/**
 * 写作台核心库的单元测试（node:test + node:assert/strict）。
 *
 * 覆盖 src/scripts/admin/lib/ 下的纯函数：
 * - frontmatter.js：splitFrontmatter / parsePost / serializePost / validateFrontmatter
 * - slug.js：normalizeSlug / isValidSlug / asciiSlug / stamp / defaultSlug / safeAssetName
 * - markdown.js：renderMarkdown / safeUrl / escapeHtml
 *
 * 运行（在仓库根目录）：
 *   node --test scripts/test-admin-lib.mjs scripts/test-admin-e2e.mjs
 *
 * 本文件不依赖任何第三方包，也不修改 src/。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  splitFrontmatter,
  parsePost,
  parseFrontmatterBlock,
  serializePost,
  parseScalar,
  serializeScalar,
  validateFrontmatter,
  buildPostSource,
  countWords,
} from '../src/scripts/admin/lib/frontmatter.js';
import {
  normalizeSlug,
  isValidSlug,
  asciiSlug,
  stamp,
  defaultSlug,
  safeAssetName,
} from '../src/scripts/admin/lib/slug.js';
import { renderMarkdown, safeUrl, escapeHtml } from '../src/scripts/admin/lib/markdown.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.resolve(HERE, '../src/content/blog');
const BT = String.fromCharCode(96); // 反引号，避免测试文件里直接出现围栏
const FENCE = BT.repeat(3);
const BLOG_FILES = fs
  .readdirSync(BLOG_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort();

/** 递归按 key 排序，用于忽略 frontmatter 键顺序的深度比较 */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

/** 从序列化结果里取出某个字段的整行文本（含键名），不存在时返回空串 */
function fieldLine(source, key) {
  const block = splitFrontmatter(source).frontmatter;
  return block.split('\n').find((line) => line.startsWith(key + ':')) || '';
}

function readSample(name) {
  return fs.readFileSync(path.join(BLOG_DIR, name), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. frontmatter：真实文章往返
// ---------------------------------------------------------------------------
describe('frontmatter：src/content/blog 真实文章 parse → serialize → parse', () => {
  it('样例文章存在', () => {
    assert.ok(BLOG_FILES.length > 0, 'src/content/blog 下应该至少有一篇 .md');
  });

  for (const file of BLOG_FILES) {
    it('往返保持等价：' + file, () => {
      const source = readSample(file);
      const parsed = parsePost(source);

      // 真实文章都必须能解析出标题/摘要/日期，并且能通过校验
      assert.ok(Object.keys(parsed.frontmatter).length > 0, file + ' 应该解析出 frontmatter');
      assert.equal(typeof parsed.frontmatter.title, 'string');
      assert.equal(typeof parsed.frontmatter.description, 'string');
      assert.match(String(parsed.frontmatter.pubDate), /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(validateFrontmatter(parsed.frontmatter), []);
      assert.ok(parsed.body.trim().length > 0, file + ' 的正文不应为空');

      const serialized = serializePost(parsed);
      const reparsed = parsePost(serialized);

      // 1) frontmatter 深度等价（键顺序由 KEY_ORDER 重排，不影响语义）
      assert.deepEqual(sortDeep(reparsed.frontmatter), sortDeep(parsed.frontmatter));
      // 2) 未知字段原样保留
      assert.deepEqual(reparsed.extras, parsed.extras);
      // 3) 正文内容不丢（serializePost 会去掉尾部空白，比较时统一 trim）
      assert.equal(reparsed.body.trim(), parsed.body.trim());
      // 4) 再序列化一次结果稳定（连存两次不会产生多余 diff）
      assert.equal(serializePost(reparsed), serialized);
      // 5) frontmatter 边界完整，正文能原样拆回
      assert.equal(serialized.split('\n')[0], '---');
      assert.equal(serialized.split('\n')[serialized.split('\n').length - 1], '');
      assert.equal(splitFrontmatter(serialized).body.trim(), parsed.body.trim());
    });
  }

  it('draft-demo.md 的 draft: true 会被保留', () => {
    const parsed = parsePost(readSample('draft-demo.md'));
    assert.equal(parsed.frontmatter.draft, true);
    assert.match(fieldLine(serializePost(parsed), 'draft'), /^draft: true$/);
  });

  it('hello-world.md 的 pinned / cover 会被保留', () => {
    const parsed = parsePost(readSample('hello-world.md'));
    assert.equal(parsed.frontmatter.pinned, true);
    const out = serializePost(parsed);
    assert.match(fieldLine(out, 'pinned'), /^pinned: true$/);
    assert.match(fieldLine(out, 'cover'), /^cover: \/covers\/terminal\.svg$/);
  });

  it('css-design-tokens.md 的 updatedDate / cover 会被保留', () => {
    const parsed = parsePost(readSample('css-design-tokens.md'));
    assert.equal(serializeScalar(parsed.frontmatter.updatedDate, { dateLike: true }), '2026-10-28');
    const out = serializePost(parsed);
    assert.match(fieldLine(out, 'updatedDate'), /^updatedDate: 2026-10-28$/);
    assert.equal(parsePost(out).frontmatter.updatedDate, '2026-10-28');
  });

  it('reading-astro-islands.md 的外链会被保留', () => {
    const parsed = parsePost(readSample('reading-astro-islands.md'));
    assert.equal(parsed.frontmatter.link, 'https://docs.astro.build/en/concepts/islands/');
    assert.equal(parsePost(serializePost(parsed)).frontmatter.link, parsed.frontmatter.link);
  });

  it('带表格/代码块/引用的正文往返后内容不变', () => {
    const parsed = parsePost(readSample('terminal-toolchain.md'));
    const round = parsePost(serializePost(parsed));
    assert.equal(round.body.trim(), parsed.body.trim());
    assert.ok(round.body.includes('| 工具 | 替代 | 一句话理由 |'));
    assert.ok(round.body.includes(FENCE + 'bash'));
    assert.ok(round.body.includes('> 工具链的目标不是'));
  });
});

// ---------------------------------------------------------------------------
// 2. frontmatter：拆分与序列化细节
// ---------------------------------------------------------------------------
describe('frontmatter：splitFrontmatter', () => {
  it('拆出 frontmatter 与 body，并去掉正文开头的空行', () => {
    const out = splitFrontmatter('---\ntitle: t\n---\n\n正文第一行\n');
    assert.equal(out.frontmatter, 'title: t');
    assert.equal(out.body, '正文第一行\n');
  });

  it('没有 frontmatter 时整篇当正文', () => {
    const out = splitFrontmatter('只有正文\n第二行');
    assert.equal(out.frontmatter, '');
    assert.equal(out.body, '只有正文\n第二行');
  });

  it('frontmatter 未闭合时整篇当正文（不会吞内容）', () => {
    const src = '---\ntitle: t\n正文\n';
    const out = splitFrontmatter(src);
    assert.equal(out.frontmatter, '');
    assert.equal(out.body, src);
  });

  it('CRLF 会被归一化成 LF', () => {
    const out = splitFrontmatter('---\r\ntitle: t\r\n---\r\n\r\n正文\r\n');
    assert.equal(out.frontmatter, 'title: t');
    assert.equal(out.body, '正文\n');
  });

  it('空输入不抛错', () => {
    assert.deepEqual(splitFrontmatter(''), { frontmatter: '', body: '' });
    assert.deepEqual(splitFrontmatter(null), { frontmatter: '', body: '' });
    assert.deepEqual(splitFrontmatter(undefined), { frontmatter: '', body: '' });
  });
});

describe('frontmatter：parseScalar / parseFrontmatterBlock', () => {
  it('布尔、null、数字、字符串', () => {
    assert.equal(parseScalar('true'), true);
    assert.equal(parseScalar('false'), false);
    assert.equal(parseScalar('null'), null);
    assert.equal(parseScalar('~'), null);
    assert.equal(parseScalar('42'), 42);
    assert.equal(parseScalar('-3.5'), -3.5);
    assert.equal(parseScalar('plain'), 'plain');
    assert.equal(parseScalar(''), '');
    assert.equal(parseScalar(undefined), '');
  });

  it('单引号里的双写单引号会还原', () => {
    assert.equal(parseScalar("'it''s ok'"), "it's ok");
  });

  it('双引号按 JSON 解析，能还原转义', () => {
    assert.equal(parseScalar('"中文 ok"'), '中文 ok');
    assert.equal(parseScalar('"a\nb"'), 'a\nb');
  });

  it('行内数组（含逗号与引号）', () => {
    assert.deepEqual(parseScalar("[ 'Astro', 'TypeScript' ]"), ['Astro', 'TypeScript']);
    assert.deepEqual(parseScalar("['a, b', 'c']"), ['a, b', 'c']);
    assert.deepEqual(parseScalar('[]'), []);
  });

  it('块数组', () => {
    const src = 'title: t\ntags:\n  - a\n  - b\npubDate: 2026-01-01\n';
    const entries = parseFrontmatterBlock(src);
    const tags = entries.find((entry) => entry.key === 'tags');
    assert.deepEqual(tags.value, ['a', 'b']);
    assert.deepEqual(parsePost('---\n' + src + '---\n\n正文').frontmatter.tags, ['a', 'b']);
  });

  it('块数组中间有空行也继续收集', () => {
    const src = 'tags:\n  - a\n\n  - b\n';
    assert.deepEqual(parseFrontmatterBlock(src)[0].value, ['a', 'b']);
  });

  it('块标量 | 保留换行，> 折叠成空格', () => {
    const src = 'description: |\n  第一行\n  第二行\nsubtitle: >\n  一\n  二\n';
    const entries = parseFrontmatterBlock(src);
    assert.equal(entries[0].value, '第一行\n第二行');
    assert.equal(entries[1].value, '一 二');
  });

  it('注释行与空行被跳过', () => {
    const src = '# 注释\ntitle: t\n\ncategory: 技术\n';
    assert.deepEqual(
      parseFrontmatterBlock(src).map((entry) => entry.key),
      ['title', 'category'],
    );
  });

  it('缩进续行会合并成一行', () => {
    const entries = parseFrontmatterBlock('description: 很长\n  接下一行\ntitle: t\n');
    assert.equal(entries[0].value, '很长 接下一行');
  });
});

describe('frontmatter：serializePost 细节', () => {
  const base = { title: '标题', description: '摘要', pubDate: '2026-11-10' };

  it('字段按 KEY_ORDER 固定顺序输出', () => {
    const out = serializePost({
      frontmatter: {
        tags: ['b', 'a'],
        title: 't',
        description: 'd',
        pubDate: '2026-11-10',
        category: '技术',
        series: 's',
      },
      extras: [],
      body: 'x',
    });
    const keys = splitFrontmatter(out).frontmatter.split('\n').map((line) => line.split(':')[0]);
    assert.deepEqual(keys, ['title', 'description', 'pubDate', 'category', 'tags', 'series']);
  });

  it('draft: false / pinned: false 不输出', () => {
    const out = serializePost({
      frontmatter: Object.assign({}, base, { draft: false, pinned: false }),
      extras: [],
      body: 'x',
    });
    assert.equal(fieldLine(out, 'draft'), '');
    assert.equal(fieldLine(out, 'pinned'), '');
    assert.ok(!out.includes('draft:'));
    assert.ok(!out.includes('pinned:'));
  });

  it('draft: true / pinned: true 输出', () => {
    const out = serializePost({
      frontmatter: Object.assign({}, base, { draft: true, pinned: true }),
      extras: [],
      body: 'x',
    });
    assert.match(fieldLine(out, 'draft'), /^draft: true$/);
    assert.match(fieldLine(out, 'pinned'), /^pinned: true$/);
  });

  it('空字符串与空数组不输出', () => {
    const out = serializePost({
      frontmatter: Object.assign({}, base, { tags: [], cover: '', subtitle: '', series: '' }),
      extras: [],
      body: 'x',
    });
    assert.equal(fieldLine(out, 'tags'), '');
    assert.equal(fieldLine(out, 'cover'), '');
    assert.equal(fieldLine(out, 'subtitle'), '');
    assert.equal(fieldLine(out, 'series'), '');
  });

  it('含 ASCII 冒号的标题会加单引号，并且能解析回原文', () => {
    const title = 'Astro 6: 把 Markdown 当成数据库';
    const out = serializePost({ frontmatter: Object.assign({}, base, { title }), extras: [], body: 'x' });
    assert.match(fieldLine(out, 'title'), /^title: '.*'/);
    assert.equal(parsePost(out).frontmatter.title, title);
  });

  it('全角冒号的标题不需要加引号，也能原样还原', () => {
    const title = 'Astro 内容集合：把 Markdown 当成数据库';
    const out = serializePost({ frontmatter: Object.assign({}, base, { title }), extras: [], body: 'x' });
    assert.equal(fieldLine(out, 'title'), 'title: ' + title);
    assert.equal(parsePost(out).frontmatter.title, title);
  });

  it('冒号后不带空格的标题也安全往返', () => {
    const title = '标题:尾巴';
    const out = serializePost({ frontmatter: Object.assign({}, base, { title }), extras: [], body: 'x' });
    assert.equal(parsePost(out).frontmatter.title, title);
  });

  it('含引号的标题安全往返', () => {
    for (const title of ['他说"你好"', "it's ok", '中文「引号」']) {
      const out = serializePost({ frontmatter: Object.assign({}, base, { title }), extras: [], body: 'x' });
      assert.equal(parsePost(out).frontmatter.title, title);
    }
  });

  it('以特殊字符开头的标题会被加引号且能还原', () => {
    const risky = ['#话题', '- 列表', '[草稿]', '{tag}', '*重点', '&amp', '%完成', '@人', '!注意', '> 引用', '?问号', BT + '反引号'];
    for (const title of risky) {
      const out = serializePost({ frontmatter: Object.assign({}, base, { title }), extras: [], body: 'x' });
      assert.equal(parsePost(out).frontmatter.title, title, '标题往返失败：' + title);
    }
  });

  it('未知字段原样保留，排在已知字段之后', () => {
    const out = serializePost({
      frontmatter: Object.assign({}, base),
      extras: [
        { key: 'customField', value: 'v1' },
        { key: 'another', value: 3 },
      ],
      body: '正文',
    });
    assert.match(fieldLine(out, 'customField'), /^customField: v1$/);
    assert.match(fieldLine(out, 'another'), /^another: 3$/);
    const reparsed = parsePost(out);
    assert.deepEqual(reparsed.extras, [
      { key: 'customField', value: 'v1' },
      { key: 'another', value: 3 },
    ]);
    assert.deepEqual(sortDeep(reparsed.frontmatter), sortDeep(base));
  });

  it('extras 里混入已知字段时不会重复输出', () => {
    const out = serializePost({
      frontmatter: Object.assign({}, base),
      extras: [{ key: 'title', value: '重复标题' }],
      body: 'x',
    });
    assert.equal(out.split('\n').filter((line) => line.startsWith('title:')).length, 1);
    assert.equal(parsePost(out).frontmatter.title, '标题');
  });

  it('正文首尾空白被规范化，内容本身不丢', () => {
    const out = serializePost({ frontmatter: Object.assign({}, base), extras: [], body: '\n\n正文\n\n' });
    assert.equal(parsePost(out).body, '正文\n');
  });

  it('空正文也能序列化', () => {
    const out = serializePost({ frontmatter: Object.assign({}, base), extras: [], body: '' });
    assert.equal(out, '---\ntitle: 标题\ndescription: 摘要\npubDate: 2026-11-10\n---\n\n\n');
  });

  it('没有 frontmatter 的文章可以 parse 再序列化', () => {
    const parsed = parsePost('只有正文');
    assert.deepEqual(parsed.frontmatter, {});
    assert.equal(parsed.body, '只有正文');
    assert.equal(parsePost(serializePost(parsed)).body, '只有正文\n');
  });

  it('buildPostSource 与 serializePost 等价', () => {
    const out1 = buildPostSource(base, [{ key: 'x', value: 'y' }], '正文');
    const out2 = serializePost({ frontmatter: base, extras: [{ key: 'x', value: 'y' }], body: '正文' });
    assert.equal(out1, out2);
  });

  it('序列化标量：null / 布尔 / 数字 / 日期 / 空格', () => {
    assert.equal(serializeScalar(null), 'null');
    assert.equal(serializeScalar(true), 'true');
    assert.equal(serializeScalar(false), 'false');
    assert.equal(serializeScalar(3), '3');
    // 日期字段（pubDate / updatedDate）走 dateLike，保持不加引号
    assert.equal(serializeScalar('2026-11-10', { dateLike: true }), '2026-11-10');
    assert.equal(serializeScalar('2026-11-10T08:30:00Z', { dateLike: true }), '2026-11-10T08:30:00Z');
    // 默认（其他字段）里的日期样字符串必须加引号，否则 YAML 会解析成 Date
    assert.equal(serializeScalar('2026-11-10'), "'2026-11-10'");
    assert.equal(serializeScalar('2026-11-10T08:30:00Z'), "'2026-11-10T08:30:00Z'");
    assert.equal(serializeScalar(''), "''");
    assert.equal(serializeScalar(' 空 '), "' 空 '");
  });
});

describe('frontmatter：validateFrontmatter', () => {
  const ok = { title: '标题', description: '摘要', pubDate: '2026-11-10' };

  it('合法数据返回空数组', () => {
    assert.deepEqual(validateFrontmatter(ok), []);
  });

  it('缺标题 / 摘要 / 日期各报一条中文错误', () => {
    assert.deepEqual(validateFrontmatter({}), ['标题不能为空', '摘要不能为空', '发布日期不能为空']);
  });

  it('标题超过 120 字报错，正好 120 字通过', () => {
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { title: '标'.repeat(120) })), []);
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { title: '标'.repeat(121) })), ['标题最长 120 个字']);
  });

  it('摘要超过 300 字报错', () => {
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { description: '摘'.repeat(301) })), ['摘要最长 300 个字']);
  });

  it('日期格式不对报错', () => {
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { pubDate: '不是日期' })), ['发布日期格式不对']);
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { updatedDate: '2026-13-45' })), ['更新日期格式不对']);
  });

  it('标签不是字符串数组时报错', () => {
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { tags: '随笔,Astro' })), ['标签需要是逗号分隔的文字']);
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { tags: ['随笔', ' '] })), ['标签需要是逗号分隔的文字']);
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { tags: ['随笔', 'Astro'] })), []);
  });

  it('外链必须是 http(s)', () => {
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { link: 'ftp://a.b' })), ['外链必须是 http(s) 地址']);
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { link: 'https://a.b' })), []);
    assert.deepEqual(validateFrontmatter(Object.assign({}, ok, { link: '' })), []);
  });
});

describe('frontmatter：countWords', () => {
  it('中文按字、英文按词', () => {
    assert.equal(countWords('中文 abc def'), 4);
    assert.equal(countWords(''), 0);
    assert.equal(countWords(null), 0);
    assert.equal(countWords('只有中文六个字'), 7);
  });
});

// ---------------------------------------------------------------------------
// 3. frontmatter：与真实 YAML 解析器（Astro 构建用的 js-yaml）的兼容性
//    BUG-1 / BUG-2 已修复，这两个用例从 skip 转成常驻回归：
//    「空格 + 井号」、日期样字符串、1e5 / 0x10 都必须加引号，
//    只有 pubDate / updatedDate（dateLike）才免引号。
// ---------------------------------------------------------------------------
describe('frontmatter：与真实 YAML 的兼容性（BUG-1 / BUG-2 回归）', () => {
  const base = { description: 'd', pubDate: '2026-11-10' };

  function titleLine(title) {
    const out = serializePost({ frontmatter: Object.assign({}, base, { title }), extras: [], body: 'x' });
    return { line: fieldLine(out, 'title'), out };
  }

  it('值里出现「空格 + 井号」时必须加引号（否则 YAML 把井号之后当注释）', () => {
    const first = titleLine('第 1 章 #2');
    assert.equal(first.line, "title: '第 1 章 #2'");
    assert.equal(parsePost(first.out).frontmatter.title, '第 1 章 #2');
    assert.equal(titleLine('a #b').line, "title: 'a #b'");
  });

  it('标签里出现「空格 + 井号」时也要加引号（否则整篇 YAML 解析失败）', () => {
    const tags = ['a #b', 'c'];
    const out = serializePost({ frontmatter: Object.assign({}, base, { title: 't', tags }), extras: [], body: 'x' });
    // 只有含「空格 + #」的那一项需要引号，普通的 c 保持不加引号
    assert.equal(fieldLine(out, 'tags'), "tags: ['a #b', c]");
    assert.deepEqual(parsePost(out).frontmatter.tags, tags);
  });

  it('长得像日期的字符串在非日期字段里必须加引号（否则 YAML 解析成 Date）', () => {
    const first = titleLine('2026-11-10');
    assert.equal(first.line, "title: '2026-11-10'");
    assert.equal(parsePost(first.out).frontmatter.title, '2026-11-10');
    assert.equal(titleLine('2026-11-10T08:30:00Z').line, "title: '2026-11-10T08:30:00Z'");
  });

  it('pubDate / updatedDate 仍然不加引号（保持真实文件 diff 干净）', () => {
    const out = serializePost({
      frontmatter: { title: 't', description: 'd', pubDate: '2026-11-10', updatedDate: '2026-11-11' },
      extras: [],
      body: 'x',
    });
    assert.equal(fieldLine(out, 'pubDate'), 'pubDate: 2026-11-10');
    assert.equal(fieldLine(out, 'updatedDate'), 'updatedDate: 2026-11-11');
    assert.equal(parsePost(out).frontmatter.pubDate, '2026-11-10');
    assert.equal(parsePost(out).frontmatter.updatedDate, '2026-11-11');
  });

  it('会被 YAML 当成数字 / 布尔的字符串也加引号（1e5 / 0x10 / 0o17 / true / null / ~）', () => {
    for (const text of ['1e5', '0x10', '0o17', 'true', 'null', '~']) {
      assert.equal(titleLine(text).line, "title: '" + text + "'", '应加引号：' + text);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. slug
// ---------------------------------------------------------------------------
describe('slug：defaultSlug / stamp', () => {
  const fixed = new Date(2026, 10, 10, 16, 50); // 2026-11-10 16:50 本地时间

  it('英文标题直接变 slug', () => {
    assert.equal(defaultSlug('Hello World!'), 'hello-world');
    assert.equal(defaultSlug('Astro 6 Notes'), 'astro-6-notes');
    assert.equal(defaultSlug('  My  Blog  '), 'my-blog');
  });

  it('纯中文标题回退到 post-时间戳', () => {
    assert.equal(defaultSlug('中文标题', fixed), 'post-20261110-1650');
    assert.equal(defaultSlug('', fixed), 'post-20261110-1650');
    assert.equal(defaultSlug('中', fixed), 'post-20261110-1650');
  });

  it('中英混排时保留英文部分', () => {
    assert.equal(defaultSlug('中文 Title', fixed), 'title');
    assert.equal(defaultSlug('用 CSS 变量', fixed), 'css');
  });

  it('超长标题截断到 80 个字符', () => {
    assert.equal(defaultSlug('a'.repeat(200), fixed).length, 80);
  });

  it('stamp 格式为 YYYYMMDD-HHmm 并补零', () => {
    assert.equal(stamp(fixed), '20261110-1650');
    assert.equal(stamp(new Date(2026, 0, 2, 3, 4)), '20260102-0304');
  });
});

describe('slug：isValidSlug', () => {
  it('拒绝路径穿越、分隔符、空串、空格、隐藏文件、超长', () => {
    const bad = ['../x', 'a/b', '', ' ', 'a b', '-lead', '.hidden', 'a.b', 'a\\b', 'x'.repeat(121), 'a?b', 'a#b'];
    for (const slug of bad) assert.equal(isValidSlug(slug), false, '应拒绝：' + JSON.stringify(slug));
  });

  it('接受字母数字、中文、连字符', () => {
    const good = ['hello-world', 'post-20261110-1656', '中文标题', 'astro6', 'a', 'x'.repeat(120)];
    for (const slug of good) assert.equal(isValidSlug(slug), true, '应接受：' + JSON.stringify(slug));
  });

  it('非字符串一律不合法', () => {
    for (const bad of [null, undefined, 42, {}, []]) assert.equal(isValidSlug(bad), false);
  });
});

describe('slug：normalizeSlug / asciiSlug / safeAssetName', () => {
  it('normalizeSlug 空格下划线变连字符、去掉多余符号', () => {
    assert.equal(normalizeSlug('Hello  World_ again!'), 'hello-world-again');
    assert.equal(normalizeSlug('  --a--b--  '), 'a-b');
    assert.equal(normalizeSlug('中文 标题'), '中文-标题');
    assert.equal(normalizeSlug(null), '');
  });

  it('asciiSlug 只留 ASCII 字母数字', () => {
    assert.equal(asciiSlug('中文 Title'), 'title');
    assert.equal(asciiSlug('C++ 入门'), 'c');
    assert.equal(asciiSlug('中文'), '');
  });

  it('safeAssetName 只留 ASCII 文件名，空则用 fallback', () => {
    assert.equal(safeAssetName('my photo 1.PNG'), 'my-photo-1');
    assert.equal(safeAssetName('封面图.png'), 'image');
    assert.equal(safeAssetName('', 'image'), 'image');
    assert.equal(safeAssetName(null, 'cover'), 'cover');
  });
});

// ---------------------------------------------------------------------------
// 5. markdown
// ---------------------------------------------------------------------------
describe('markdown：escapeHtml / safeUrl', () => {
  it('escapeHtml 转义 5 个危险字符', () => {
    assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(123), '123');
  });

  it('放行 http(s) / mailto / 站内相对路径 / 锚点', () => {
    assert.equal(safeUrl('https://astro.build'), 'https://astro.build');
    assert.equal(safeUrl('http://a.b/c?d=1'), 'http://a.b/c?d=1');
    assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
    assert.equal(safeUrl('/blog/x/'), '/blog/x/');
    assert.equal(safeUrl('#anchor'), '#anchor');
    assert.equal(safeUrl('//cdn.a.b/x.png'), '//cdn.a.b/x.png');
  });

  it('拒绝 javascript: / data: / vbscript:（大小写都算）', () => {
    const bad = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ];
    for (const url of bad) assert.equal(safeUrl(url), '', '应拒绝：' + JSON.stringify(url));
  });

  it('空值返回空串', () => {
    assert.equal(safeUrl(''), '');
    assert.equal(safeUrl(null), '');
    assert.equal(safeUrl(undefined), '');
  });

  it('引号被编码成 %22 / %27，避免逃出属性', () => {
    assert.equal(safeUrl('https://a.b/"/x'), 'https://a.b/%22/x');
    assert.equal(safeUrl("https://a.b/'/x"), 'https://a.b/%27/x');
  });
});

describe('markdown：代码与转义', () => {
  it('围栏代码块内容被转义，语言标记成 class', () => {
    const md = FENCE + 'js\nconst a = 1 < 2 && b > 0;\n' + FENCE;
    const html = renderMarkdown(md);
    assert.equal(html, '<pre><code class="language-js">const a = 1 &lt; 2 &amp;&amp; b &gt; 0;</code></pre>');
  });

  it('围栏代码块里的 script 标签只以文本出现', () => {
    const md = FENCE + 'html\n<script>alert(1)</script>\n' + FENCE;
    const html = renderMarkdown(md);
    assert.equal(html, '<pre><code class="language-html">&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
    assert.ok(!html.includes('<script'));
  });

  it('行内代码被转义，里面的星号不再当语法', () => {
    const md = 'run ' + BT + 'a < b && c * d*' + BT + ' now';
    const html = renderMarkdown(md);
    assert.match(html, /<code>a &lt; b &amp;&amp; c \* d\*<\/code>/);
    assert.ok(!html.includes('<em>'));
  });

  it('段落里的裸 script 标签被转义', () => {
    assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('多种 XSS 输入都不会产出可执行标签', () => {
    const inputs = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      FENCE + 'html\n<iframe src=javascript:alert(1)></iframe>\n' + FENCE,
      '正常文字 <div onclick="x">点击</div>',
    ];
    for (const input of inputs) {
      const html = renderMarkdown(input);
      assert.ok(!html.includes('<script'), '不应输出 script 标签：' + input);
      assert.ok(!html.includes('<iframe'), '不应输出 iframe 标签：' + input);
      assert.ok(!html.includes('<svg'), '不应输出 svg 标签：' + input);
      assert.ok(!html.includes('<div onclick'), '不应输出原始 div：' + input);
    }
  });
});

describe('markdown：链接与图片', () => {
  it('javascript: 链接被拒绝，只留文字、不残留孤立括号', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))');
    assert.equal(html, '<p>点我</p>');
    assert.ok(!html.includes('<a '), '不应输出链接：' + html);
    assert.ok(!html.includes('javascript:'));
    assert.ok(html.includes('点我'), '标签文字应保留');
  });

  it('javascript: 图片被拒绝，只留 alt 文字', () => {
    const html = renderMarkdown('![图](javascript:alert(1))');
    assert.equal(html, '<p>图</p>');
    assert.ok(!html.includes('<img'), '不应输出图片：' + html);
    assert.ok(!html.includes('javascript:'));
  });

  it('链接地址里的成对括号不会丢失或残留孤立括号', () => {
    assert.equal(
      renderMarkdown('[维基](https://a.b/wiki/A_(b))'),
      '<p><a href="https://a.b/wiki/A_(b)" target="_blank" rel="noopener noreferrer">维基</a></p>',
    );
  });

  it('普通外链带 target/rel', () => {
    assert.equal(
      renderMarkdown('[Astro](https://astro.build)'),
      '<p><a href="https://astro.build" target="_blank" rel="noopener noreferrer">Astro</a></p>',
    );
  });

  it('站内相对链接不加 target', () => {
    assert.equal(renderMarkdown('[首页](/blog/x/)'), '<p><a href="/blog/x/">首页</a></p>');
  });

  it('mailto 链接可用', () => {
    assert.equal(renderMarkdown('[写信](mailto:a@b.c)'), '<p><a href="mailto:a@b.c">写信</a></p>');
  });

  it('图片渲染成 img 带 alt 与 lazy', () => {
    assert.equal(
      renderMarkdown('![封面](/covers/terminal.svg)'),
      '<p><img src="/covers/terminal.svg" alt="封面" loading="lazy" /></p>',
    );
  });

  it('图片 alt 里的引号被转义', () => {
    const html = renderMarkdown('![他说"嗨"](/a.png)');
    assert.ok(html.includes('alt="他说&quot;嗨&quot;"'), html);
  });
});

describe('markdown：块级元素', () => {
  it('标题 1-3 级', () => {
    assert.equal(renderMarkdown('# 一级'), '<h1>一级</h1>');
    assert.equal(renderMarkdown('## 二级'), '<h2>二级</h2>');
    assert.equal(renderMarkdown('### 三级'), '<h3>三级</h3>');
  });

  it('无序列表', () => {
    assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(renderMarkdown('* a\n+ b'), '<ul><li>a</li><li>b</li></ul>');
  });

  it('有序列表与起始序号', () => {
    assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
    assert.equal(renderMarkdown('3. a\n4. b'), '<ol start="3"><li>a</li><li>b</li></ol>');
  });

  it('列表项里可以带行内格式', () => {
    assert.equal(renderMarkdown('- **重点**'), '<ul><li><strong>重点</strong></li></ul>');
  });

  it('引用', () => {
    assert.equal(renderMarkdown('> hello'), '<blockquote>\n<p>hello</p>\n</blockquote>');
    assert.equal(renderMarkdown('> 第一行\n> 第二行'), '<blockquote>\n<p>第一行\n第二行</p>\n</blockquote>');
  });

  it('分隔线', () => {
    assert.equal(renderMarkdown('---'), '<hr />');
    assert.equal(renderMarkdown('***'), '<hr />');
  });

  it('表格（含对齐）', () => {
    const html = renderMarkdown('| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    assert.ok(html.includes('<div class="md-table-wrap"><table>'), html);
    assert.ok(html.includes('<th style="text-align:left">左</th>'), html);
    assert.ok(html.includes('<th style="text-align:center">中</th>'), html);
    assert.ok(html.includes('<th style="text-align:right">右</th>'), html);
    assert.ok(html.includes('<td style="text-align:left">1</td>'), html);
    assert.ok(html.includes('</tr></tbody></table></div>'), html);
  });

  it('表格单元格里的行内代码与加粗', () => {
    const html = renderMarkdown('| 工具 | 说明 |\n| --- | --- |\n| ' + BT + 'rg' + BT + ' | **快** |');
    assert.ok(html.includes('<td><code>rg</code></td>'), html);
    assert.ok(html.includes('<td><strong>快</strong></td>'), html);
  });

  it('加粗 / 斜体 / 删除线', () => {
    assert.equal(renderMarkdown('**粗**'), '<p><strong>粗</strong></p>');
    assert.equal(renderMarkdown('*斜*'), '<p><em>斜</em></p>');
    assert.equal(renderMarkdown('~~删~~'), '<p><del>删</del></p>');
    assert.equal(renderMarkdown('__粗__'), '<p><strong>粗</strong></p>');
  });

  it('硬换行（行尾两个空格）渲染成 br', () => {
    assert.equal(renderMarkdown('a  \nb'), '<p>a<br />\nb</p>');
  });

  it('空输入 / null / undefined 不抛错，返回空串', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown('   \n\n  '), '');
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown(undefined), '');
  });

  it('CRLF 输入等价于 LF', () => {
    assert.equal(renderMarkdown('# 标题\r\n\r\n正文\r\n'), renderMarkdown('# 标题\n\n正文\n'));
  });

  it('未闭合的代码围栏不会丢掉后面的内容', () => {
    assert.equal(
      renderMarkdown(FENCE + 'js\nconst a = 1;'),
      '<pre><code class="language-js">const a = 1;</code></pre>',
    );
  });

  it('渲染真实文章的正文不抛错且产出结构', () => {
    const body = parsePost(readSample('hello-world.md')).body;
    const html = renderMarkdown(body);
    assert.ok(html.length > 100);
    assert.ok(html.includes('<h2>三个约束</h2>'), html.slice(0, 300));
    assert.ok(html.includes('<blockquote>'));
    assert.ok(html.includes('<pre><code class="language-bash">'));
    assert.ok(!html.includes('<script'));
  });
});
