/* eslint-env serviceworker */
/**
 * 写作台的 Service Worker。
 *
 * 只做三件事：
 *   1. 让 /admin/ 可以「添加到主屏幕 / 安装成应用」（Chrome 需要 SW 才给安装提示）；
 *   2. 断网时仍能打开写作台，读到本机草稿；
 *   3. 缓存构建产物和已上传的图片，弱网下不白屏。
 *
 * 页面 HTML 用 network-first：宁可多等一次网络，也不要让你在手机上看到旧界面。
 * 带 hash 的 /_astro/ 产物用 cache-first，内容变了文件名就变了，不存在过期问题。
 * GitHub API（api.github.com）跨域，SW 一律不碰。
 */

const VERSION = 'czw-admin-v2';
const SHELL = ['/admin/', '/admin/manifest.webmanifest', '/admin/icon-192.png', '/admin/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // 单个失败不影响其他资源，避免一个 404 就让 SW 装不上
      await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('/admin/');
    if (shell) return shell;
    return new Response('离线了，也没找到缓存的写作台。连上网络再试一次。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

/** 图片这类「文件名基本不变」的资源：先给缓存，后台顺手更新 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // GitHub API 等直连，不缓存
  if (url.pathname === '/admin/sw.js') return; // 让浏览器自己去更新 SW

  if (request.mode === 'navigate' || url.pathname === '/admin/' || url.pathname === '/admin') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/uploads/')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
