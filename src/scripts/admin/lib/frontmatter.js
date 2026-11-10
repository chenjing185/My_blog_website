/**
 * 博客 frontmatter 的解析 / 序列化 / 校验。
 *
 * 只覆盖本站 schema（见 src/content.config.ts）用得到的 YAML 子集：
 * - 单行标量（含单双引号）
 * - 行内数组 ['a', 'b']
 * - 块数组（每行 - item）
 * - 块标量 | 与 >
 * - 布尔、数字、null
 *
 * 设计原则：编辑已有文章时，**不认识的键原样保留**，避免把用户手工加的字段吃掉。
 */

export const KNOWN_KEYS = [
  'title',
  'description',
  'pubDate',
  'updatedDate',
  'category',
  'tags',
  'series',
  'draft',
  'pinned',
  'cover',
  'subtitle',
  'link',
];

/** 输出 frontmatter 时字段的固定顺序，保证每次保存的 diff 干净 */
export const KEY_ORDER = KNOWN_KEYS;

/** 把文章拆成 frontmatter 文本与正文 */
export function splitFrontmatter(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return { frontmatter: '', body: text };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { frontmatter: '', body: text };
  const frontmatter = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  return { frontmatter, body };
}

function parseDoubleQuoted(raw) {
  // YAML 双引号与 JSON 字符串基本同构，差一些转义，这里用 JSON 兜底
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  }
}

function parseSingleQuoted(raw) {
  return raw.slice(1, -1).replace(/''/g, "'");
}

function splitFlow(inner) {
  const parts = [];
  let buf = '';
  let quote = '';
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          buf += inner[i + 1];
          i += 1;
        } else {
          quote = '';
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** 解析一个标量（已经被 trim 过） */
export function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return '';
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return parseSingleQuoted(value);
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return parseDoubleQuoted(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitFlow(value.slice(1, -1)).map((part) => parseScalar(part));
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * 把 frontmatter 文本解析成有序条目。
 * 返回 [{ key, value }]，保持文件里的顺序，便于原样保留未知字段。
 */
export function parseFrontmatterBlock(frontmatter) {
  const lines = String(frontmatter ?? '').replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }

    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }

    const key = match[1];
    const rawValue = match[2].trim();
    i += 1;

    // 块标量：| 或 >，可带 +/-
    if (/^[|>][+-]?$/.test(rawValue)) {
      const collected = [];
      while (i < lines.length) {
        const current = lines[i];
        if (current.trim() !== '' && !/^\s+/.test(current)) break;
        collected.push(current.replace(/^\s{2}/, ''));
        i += 1;
      }
      const text = collected.join('\n').replace(/\n+$/, '');
      entries.push({ key, value: rawValue.startsWith('|') ? text : text.split('\n').map((row) => row.trim()).join(' ') });
      continue;
    }

    // 空值：可能是块数组或空字符串
    if (rawValue === '') {
      const items = [];
      while (i < lines.length) {
        const current = lines[i];
        const itemMatch = /^\s*-\s+(.*)$/.exec(current);
        if (itemMatch) {
          items.push(parseScalar(itemMatch[1]));
          i += 1;
          continue;
        }
        if (current.trim() === '' && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          i += 1;
          continue;
        }
        break;
      }
      entries.push({ key, value: items.length > 0 ? items : '' });
      continue;
    }

    // 普通标量 + 缩进续行
    let value = parseScalar(rawValue);
    while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*-\s+/.test(lines[i])) {
      const continuation = lines[i].trim();
      value = typeof value === 'string' ? `${value} ${continuation}` : value;
      i += 1;
    }
    entries.push({ key, value });
  }

  return entries;
}

/**
 * 解析一篇完整文章。
 * @returns {{ frontmatter: Record<string, unknown>, extras: {key:string, value:unknown}[], body: string }}
 */
export function parsePost(source) {
  const { frontmatter: raw, body } = splitFrontmatter(source);
  const entries = parseFrontmatterBlock(raw);
  const frontmatter = {};
  const extras = [];
  for (const entry of entries) {
    if (KNOWN_KEYS.includes(entry.key)) {
      if (!(entry.key in frontmatter)) frontmatter[entry.key] = entry.value;
    } else {
      extras.push(entry);
    }
  }
  return { frontmatter, extras, body };
}

const DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function needsQuote(value) {
  if (value === '') return true;
  // 非日期字段里的日期样字符串必须加引号，否则 YAML 会把它变成 Date
  if (DATE_LIKE_RE.test(value)) return true;
  if (/^\s|\s$/.test(value)) return true;
  if (/^[\-?:,\[\]{}#&*!|>'"%@`]/.test(value)) return true;
  // 冒号/井号后跟空白会被 YAML 当成映射或注释；「空格 + #」同样是注释起点
  if (/[:#]\s|\s#|\n/.test(value)) return true;
  // 会被 YAML 解析成布尔 / 数字（含科学计数、十六进制、八进制）的字符串要加引号
  if (/^(true|false|null|~|-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)$/i.test(value)) return true;
  if (/^0x[0-9a-f]+$/i.test(value)) return true;
  if (/^0o[0-7]+$/i.test(value)) return true;
  return false;
}

/**
 * 序列化一个标量。
 * dateLike 只在 pubDate / updatedDate 上开启：其他字段里写 "2026-11-10" 是字符串，
 * 不加引号会被 YAML 解析成 Date，导致 title 之类的 z.string() 校验失败。
 */
export function serializeScalar(value, options = {}) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const text = String(value);
  if (options.dateLike && DATE_LIKE_RE.test(text)) return text;
  return needsQuote(text) ? `'${text.replace(/'/g, "''")}'` : text;
}

function serializeValue(value, key) {
  const dateLike = key === 'pubDate' || key === 'updatedDate';
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeScalar(item, { dateLike })).join(', ')}]`;
  }
  return serializeScalar(value, { dateLike });
}

/** 按固定顺序 + 保留未知字段，序列化整篇文章 */
export function serializePost({ frontmatter = {}, extras = [], body = '' }) {
  const lines = [];
  const push = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    lines.push(`${key}: ${serializeValue(value, key)}`);
  };

  push('title', frontmatter.title);
  push('description', frontmatter.description);
  push('pubDate', frontmatter.pubDate);
  push('updatedDate', frontmatter.updatedDate);
  push('category', frontmatter.category);
  push('tags', frontmatter.tags);
  push('series', frontmatter.series);
  if (frontmatter.draft === true) push('draft', true);
  if (frontmatter.pinned === true) push('pinned', true);
  push('cover', frontmatter.cover);
  push('subtitle', frontmatter.subtitle);
  push('link', frontmatter.link);

  for (const entry of extras) {
    if (!entry || !entry.key || KNOWN_KEYS.includes(entry.key)) continue;
    push(entry.key, entry.value);
  }

  const normalizedBody = String(body ?? '').replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n\n${normalizedBody}\n`;
}

/** 正文字数（中文按字算，英文按词算，用来给个大概手感） */
export function countWords(body) {
  const text = String(body ?? '');
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) ?? []).length;
  return cjk + latin;
}

/** 校验 frontmatter，返回中文错误列表；空数组表示可以提交 */
export function validateFrontmatter(frontmatter) {
  const errors = [];
  const title = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';

  if (!title) errors.push('标题不能为空');
  else if ([...title].length > 120) errors.push('标题最长 120 个字');

  if (!description) errors.push('摘要不能为空');
  else if ([...description].length > 300) errors.push('摘要最长 300 个字');

  if (!frontmatter.pubDate) errors.push('发布日期不能为空');
  else if (Number.isNaN(Date.parse(String(frontmatter.pubDate)))) errors.push('发布日期格式不对');

  if (frontmatter.updatedDate && Number.isNaN(Date.parse(String(frontmatter.updatedDate)))) {
    errors.push('更新日期格式不对');
  }

  if (frontmatter.tags !== undefined) {
    if (!Array.isArray(frontmatter.tags) || frontmatter.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
      errors.push('标签需要是逗号分隔的文字');
    }
  }

  if (frontmatter.link !== undefined && frontmatter.link !== '') {
    if (!/^https?:\/\//i.test(String(frontmatter.link))) errors.push('外链必须是 http(s) 地址');
  }

  return errors;
}

/** 由文章数据 + 正文生成最终提交内容 */
export function buildPostSource(frontmatter, extras, body) {
  return serializePost({ frontmatter, extras, body });
}
