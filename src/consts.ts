/**
 * 站点全局配置 —— 改这里就够了，不用动页面代码
 */
export const SITE = {
  /** 站点名，显示在标题栏与头部 */
  title: 'myblog',
  /** 一句话副标题，首页大字下方 */
  tagline: '在终端里，认真写字。',
  /** 站点描述，用于 SEO / RSS */
  description: '一个用 Astro 搭建的静态博客，记录工程实践、设计系统与工具链。',
  author: {
    name: 'Your Name',
    /** 可选，出现在文章页与 RSS */
    bio: '写代码，也写代码之外的东西。',
  },
  /** 语言与地区（影响 <html lang> 与日期格式） */
  lang: 'zh-CN',
  /** 建站年份，用于页脚版权区间 */
  since: 2026,
  /** 顶部导航，顺序即展示顺序 */
  nav: [
    { href: '/blog/', label: 'blog' },
    { href: '/tags/', label: 'tags' },
    { href: '/about/', label: 'about' },
  ],
  /** 社交链接，留空数组则不渲染 */
  social: [
    { label: 'GitHub', href: 'https://github.com/' },
    { label: 'RSS', href: '/rss.xml' },
  ],
} as const;

/** 首页展示的最新文章数量 */
export const LATEST_POSTS = 5;
