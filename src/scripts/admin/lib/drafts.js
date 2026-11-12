/**
 * 本地草稿的多槽位存储。
 *
 * 旧实现把草稿存在一个固定的 localStorage 键里，写 A 写到一半切去改 B，
 * 700ms 后 B 的快照就会把 A 覆盖掉——这是唯一会真正丢稿子的地方。
 *
 * 这里改成「key → snapshot」的映射：key 就是文章 slug（新文章是 __new__），
 * 每篇各自一个槽位；整体仍然只占一个 localStorage 键，方便一次性读写。
 * 全部是纯函数（不碰 localStorage），可以在 Node 里直接单测。
 */

import { parsePost } from './frontmatter.js';

/** 最多保留多少份草稿，超过按保存时间淘汰最旧的 */
export const DRAFT_LIMIT = 20;

/** 草稿总字节上限，避免把 localStorage（通常 5MB）撑爆 */
export const DRAFT_TOTAL_BYTES = 1_200_000;

/** 新文章（还没有 slug）用的固定槽位 */
export const NEW_DRAFT_KEY = '__new__';

/** 由 slug 得到草稿槽位 key；空值落到「新文章」槽位 */
export function draftKeyForSlug(slug) {
  const value = String(slug ?? '').trim();
  return value || NEW_DRAFT_KEY;
}

/** 把 localStorage 里的东西（JSON 字符串或已解析对象）读成干净的映射 */
export function readDrafts(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    try {
      data = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

  const out = {};
  for (const [key, snapshot] of Object.entries(data)) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
    out[String(key)] = snapshot;
  }
  return out;
}

/** 一份草稿占多少字节（粗算即可，用于淘汰） */
export function snapshotBytes(snapshot) {
  try {
    return new TextEncoder().encode(JSON.stringify(snapshot ?? {})).length;
  } catch {
    return 0;
  }
}

/** 按保存时间保留最近若干份，并卡住总字节上限 */
export function pruneDrafts(drafts) {
  const entries = Object.entries(readDrafts(drafts)).sort(
    (a, b) => Number(b[1].savedAt ?? 0) - Number(a[1].savedAt ?? 0)
  );

  const out = {};
  let bytes = 0;
  let count = 0;
  for (const [key, snapshot] of entries) {
    if (count >= DRAFT_LIMIT) break;
    const size = snapshotBytes(snapshot);
    // 至少保留一份，否则正文写太长时会把唯一的草稿也淘汰掉
    if (count > 0 && bytes + size > DRAFT_TOTAL_BYTES) break;
    out[key] = snapshot;
    bytes += size;
    count += 1;
  }
  return out;
}

/** 写入（或覆盖）一个槽位，返回新的映射 */
export function putDraft(drafts, key, snapshot) {
  const next = { ...readDrafts(drafts) };
  const slot = String(key ?? NEW_DRAFT_KEY);
  next[slot] = { ...(snapshot || {}), key: slot, savedAt: Number((snapshot && snapshot.savedAt) || Date.now()) };
  return pruneDrafts(next);
}

/** 删掉一个槽位，返回新的映射 */
export function removeDraft(drafts, key) {
  const next = { ...readDrafts(drafts) };
  delete next[String(key ?? '')];
  return next;
}

/** 取一个槽位，没有就返回 null */
export function pickDraft(drafts, key) {
  const source = readDrafts(drafts);
  return source[String(key ?? '')] ?? null;
}

/** 列表页要展示的摘要，按最近保存排前面 */
export function listDrafts(drafts) {
  const source = readDrafts(drafts);
  return Object.values(source)
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .sort((a, b) => Number(b.savedAt ?? 0) - Number(a.savedAt ?? 0))
    .map((snapshot) => ({
      key: String(snapshot.key ?? ''),
      title: String(snapshot.title || '').trim() || '（未命名）',
      isNew: Boolean(snapshot.isNew),
      savedAt: Number(snapshot.savedAt ?? 0),
      chars: String(snapshot.body ?? '').length,
      remoteBackup: Boolean(snapshot.remoteBackup),
    }));
}

function dateOnly(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''));
  return match ? match[1] : '';
}

/**
 * 从一份 Markdown 源文本生成草稿快照。
 * 用途：覆盖冲突时把被覆盖的远端版本在本机留一份，后悔了还能从列表页恢复。
 */
export function snapshotFromSource(key, source, options = {}) {
  const { title = '', remoteBackup = false, savedAt = Date.now() } = options;
  const { frontmatter: fm, body } = parsePost(source);
  const slot = String(key ?? NEW_DRAFT_KEY);

  return {
    key: slot,
    savedAt,
    isNew: false,
    remoteBackup,
    title: title || String(fm.title || ''),
    description: String(fm.description || ''),
    pubdate: dateOnly(fm.pubDate),
    updated: dateOnly(fm.updatedDate),
    category: String(fm.category || ''),
    tags: Array.isArray(fm.tags) ? fm.tags.join(', ') : '',
    series: String(fm.series || ''),
    cover: String(fm.cover || ''),
    link: String(fm.link || ''),
    subtitle: String(fm.subtitle || ''),
    slug: slot === NEW_DRAFT_KEY ? '' : slot,
    draft: Boolean(fm.draft),
    pinned: Boolean(fm.pinned),
    body: String(body || ''),
  };
}
