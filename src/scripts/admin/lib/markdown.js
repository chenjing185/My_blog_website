/**
 * 极简 Markdown → HTML 渲染器（预览用）。
 *
 * 为什么不用 marked/remark：
 * - 预览只是给自己看，不需要 100% 兼容 CommonMark；
 * - 少一个运行时依赖，构建更稳；
 * - 所有输入先转义，只输出固定标签，天然防 XSS。
 *
 * 支持：标题、段落、加粗/斜体/删除线、行内代码、围栏代码块、链接、图片、
 * 无序/有序列表（含一级嵌套）、引用、分隔线、表格、硬换行。
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function decodeBasicEntities(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 只放行 http(s)、mailto、站内相对路径、锚点，其余（javascript: 等）丢弃 */
export function safeUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  const decoded = decodeBasicEntities(url);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(decoded);
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) return '';
  return url.replace(/"/g, '%22').replace(/'/g, '%27');
}

function renderInline(raw) {
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let text = escapeHtml(raw);

  // 行内代码优先级最高，先挖出来，避免里面的 * _ [ ] 被当成语法
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));

  // 图片（不支持 title 语法，够用）
  text = text.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_, alt, src) => {
    const url = safeUrl(src);
    if (!url) return keep(escapeHtml(alt || '[图片]'));
    return keep(`<img src="${url}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy" />`);
  });

  // 链接
  text = text.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_, label, href) => {
    const url = safeUrl(href);
    if (!url) return keep(label);
    const external = /^(https?:)?\/\//i.test(decodeBasicEntities(href));
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return keep(`<a href="${url}"${attrs}>${label}</a>`);
  });

  // 粗体 / 删除线 / 斜体
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)] ?? '');
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const UL_RE = /^ {0,3}([-*+])\s+(.*)$/;
const OL_RE = /^ {0,3}(\d+)[.)]\s+(.*)$/;

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines, index) {
  return Boolean(lines[index]?.includes('|')) && index + 1 < lines.length && isTableSeparator(lines[index + 1]);
}

function splitCells(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

function renderTable(lines, start) {
  const header = splitCells(lines[start]);
  const align = splitCells(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
    rows.push(splitCells(lines[i]));
    i += 1;
  }
  const cell = (tag, text, index) => {
    const style = align[index] ? ` style="text-align:${align[index]}"` : '';
    return `<${tag}${style}>${renderInline(text)}</${tag}>`;
  };
  const head = `<thead><tr>${header.map((text, index) => cell('th', text, index)).join('')}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows
        .map((row) => `<tr>${header.map((_, index) => cell('td', row[index] ?? '', index)).join('')}</tr>`)
        .join('')}</tbody>`
    : '';
  return { html: `<div class="md-table-wrap"><table>${head}${body}</table></div>`, next: i };
}

function renderList(lines, start) {
  const ordered = OL_RE.test(lines[start]);
  const pattern = ordered ? OL_RE : UL_RE;
  const first = pattern.exec(lines[start]);
  const listStart = ordered ? Number(first[1]) : 1;
  const items = [];
  let current = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      const next = lines[i + 1];
      const continues = next !== undefined && (/^\s{2,}\S/.test(next) || pattern.test(next));
      if (!continues) break;
      if (current) current.push('');
      i += 1;
      continue;
    }
    const match = pattern.exec(line);
    if (match) {
      current = [match[2]];
      items.push(current);
      i += 1;
      continue;
    }
    if (/^\s{2,}\S/.test(line) && current) {
      current.push(line.replace(/^\s{2,4}/, ''));
      i += 1;
      continue;
    }
    break;
  }

  const itemHtml = items
    .map((itemLines) => {
      const [head, ...rest] = itemLines;
      const restHtml = rest.length ? renderBlocks(rest).join('\n') : '';
      return `<li>${renderInline(head)}${restHtml}</li>`;
    })
    .join('');

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && listStart !== 1 ? ` start="${listStart}"` : '';
  return { html: `<${tag}${startAttr}>${itemHtml}</${tag}>`, next: i };
}

function isBlockStart(line) {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    /^ {0,3}>/.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line)
  );
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = (fence[2] ?? '').replace(/[^\w-]/g, '');
      const code = [];
      i += 1;
      while (i < lines.length) {
        const close = FENCE_RE.exec(lines[i]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
          i += 1;
          break;
        }
        code.push(lines[i]);
        i += 1;
      }
      const cls = lang ? ` class="language-${lang}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (HR_RE.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>\n${renderBlocks(quoted).join('\n')}\n</blockquote>`);
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    const html = renderInline(paragraph.join('\n'))
      .replace(/ {2}\n/g, '<br />\n')
      .replace(/\n/g, '\n');
    out.push(`<p>${html}</p>`);
  }

  return out;
}

/** 把 Markdown 渲染成可用于预览的 HTML 片段 */
export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  return renderBlocks(text.split('\n')).join('\n');
}
