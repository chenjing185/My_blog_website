/**
 * 文章文件名（slug）相关的纯函数。
 * 站点把 src/content/blog/<slug>.md 的文件名直接当 URL 的一部分，
 * 所以这里既负责"从标题猜一个"，也负责校验用户手填的 slug。
 */

/** 允许的 slug：字母 / 数字 / 汉字 / 连字符，不能以连字符开头 */
const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u;

/**
 * 把任意字符串清洗成 slug 候选：保留 Unicode 字母数字，空格与下划线变连字符。
 */
export function normalizeSlug(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** slug 是否合法（允许中文，禁止路径分隔符、空白、点号开头的隐藏文件） */
export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length >= 1 && slug.length <= 120 && SLUG_RE.test(slug);
}

/** 只保留 ASCII 字母数字，用于"从标题猜文件名"，中文标题会被清空 */
export function asciiSlug(input) {
  return normalizeSlug(input)
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 本地时间戳，格式 20261110-1650 */
export function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * 给新文章生成默认文件名。
 * 英文标题 → 标题本身；纯中文标题 → post-20261110-1650（可手动改成中文 slug）。
 */
export function defaultSlug(title, date = new Date()) {
  const ascii = asciiSlug(title);
  if (ascii.length >= 2) return ascii.slice(0, 80);
  return `post-${stamp(date)}`;
}

/** 图片等资源文件名：只留 ASCII，避免中文文件名在不同平台上的编码问题 */
export function safeAssetName(name, fallback = 'image') {
  const base = String(name ?? '').replace(/\.[^.]+$/, '');
  const ascii = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || fallback;
}
