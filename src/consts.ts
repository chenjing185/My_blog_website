/**
 * 站点全局配置 —— 改这里就够了，不用动页面代码
 */
export const SITE = {
  /** 站点名，显示在标题栏与头部 */
  title: '箱中世界',
  /** 一句话副标题，首页大字下方 */
  tagline: '在终端里，认真写字。',
  /** 站点描述，用于 SEO / RSS */
  description: '一个用 Astro 搭建的静态博客，记录工程实践、设计系统与工具链。',
  author: {
    name: 'lastembryo',
    /** 可选，出现在文章页与 RSS */
    bio: '写代码，也写代码之外的东西。',
  },
  /** 语言与地区（影响 <html lang> 与日期格式） */
  lang: 'zh-CN',
  /** 建站年份，用于页脚版权区间 */
  since: 2026,
  /** 顶部导航，顺序即展示顺序 */
  nav: [
    { href: '/blog/', label: '文章' },
    { href: '/archives/', label: '归档' },
    { href: '/categories/', label: '分类' },
    { href: '/collections/', label: '专栏' },
    { href: '/tags/', label: '标签' },
    { href: '/about/', label: '关于我' },
  ],
  /** 社交链接，留空数组则不渲染 */
  social: [
    { label: 'GitHub', href: 'https://github.com/' },
    { label: 'RSS', href: '/rss.xml' },
  ],
} as const;

/** 首页展示的最新文章数量 */
export const LATEST_POSTS = 5;

/**
 * Giscus 评论（基于 GitHub Discussions，零后端）
 * 开通步骤：
 *   1. 仓库 Settings → General → Features 勾选 Discussions
 *   2. https://github.com/apps/giscus 安装到该仓库
 *   3. 打开 https://giscus.app/zh-CN 填入仓库名，复制 repoId 与 categoryId
 *   4. 填到下面，重新构建即可。留空则整块评论不渲染。
 */
export const GISCUS = {
  repo: 'chenjing185/My_blog_website', // 例如 'lastembryo/myblog'
  repoId: 'R_kgDOVmw5LQ', // 例如 'R_kgDOxxxxxx'
  category: 'Announcements',
  categoryId: 'DIC_kwDOVmw5Lc4DKpFQ', // 例如 'DIC_kwDOxxxxxx'
};

/** 站点统计（不蒜子，免费、无需注册） */
export const STATS = {
  enabled: true,
  /** 页脚显示站点总访问量 / 访客数 */
  showSiteStats: true,
  /** 文章页显示本篇阅读量 */
  showPageViews: true,
};
