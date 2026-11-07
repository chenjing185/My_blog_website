/** 把日期格式化为 2026-11-07（按 UTC，避免时区导致的日期偏移） */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 把日期格式化为 2026.11.07，用于列表的极客风时间戳 */
export function formatStamp(date: Date): string {
  return formatDate(date).replaceAll('-', '.');
}

/** 中文长格式：2026 年 11 月 7 日 */
export function formatDateCN(date: Date): string {
  const [y, m, d] = formatDate(date).split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/**
 * 估算阅读时长（分钟）
 * 中文按 350 字/分钟，西文按 200 词/分钟，混合内容相加
 */
export function readingTime(text: string | undefined): number {
  if (!text) return 1;
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjk ? cjk.length : 0;
  const rest = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ');
  const words = rest.split(/\s+/).filter(Boolean).length;
  const minutes = cjkCount / 350 + words / 200;
  return Math.max(1, Math.round(minutes));
}

/** 粗略去掉 Markdown 语法，用于搜索索引摘要 */
export function stripMarkdown(md: string | undefined): string {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}[>\-*+]\s+/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 摘要截断，按字符数（中文友好） */
export function truncate(text: string, max = 120): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}
