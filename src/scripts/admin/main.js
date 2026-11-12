/**
 * 写作台前端逻辑。
 *
 * 结构：
 *   1. 常量 / 状态 / 小工具
 *   2. 本地存储（草稿多槽位、列表缓存）
 *   3. 视图切换与路由（#/、#/new、#/edit/<slug>、#/settings）
 *   4. GitHub 连接与设置
 *   5. 文章列表（带 sha 缓存、标签补全、草稿提示）
 *   6. 编辑器（保存、重命名、删除、图片、预览、自动草稿）
 *   7. 图片库
 *   8. 事件绑定与启动
 */

import { createGitHubClient, GitHubError } from './lib/github.js';
import { createDemoClient } from './lib/mock.js';
import { parsePost, serializePost, validateFrontmatter, countWords } from './lib/frontmatter.js';
import { renderMarkdown } from './lib/markdown.js';
import { defaultSlug, isValidSlug, safeAssetName } from './lib/slug.js';
import { compressImage } from './lib/image.js';
import {
  NEW_DRAFT_KEY,
  draftKeyForSlug,
  listDrafts,
  pickDraft,
  putDraft,
  readDrafts,
  removeDraft,
  snapshotFromSource,
} from './lib/drafts.js';

const DEFAULT_CONFIG = {
  token: '',
  owner: 'chenjing185',
  repo: 'My_blog_website',
  branch: 'main',
  dir: 'src/content/blog',
  netlifySite: '',
};

const UPLOADS_DIR = 'public/uploads';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** 令牌保存多久后提醒换新（细粒度 PAT 常见有效期 90 天） */
const TOKEN_WARN_DAYS = 80;

const KEYS = {
  config: 'czw.admin.config.v1',
  theme: 'czw.admin.theme',
  drafts: 'czw.admin.drafts.v1',
  cache: 'czw.admin.listcache.v1',
  tokenWarned: 'czw.admin.tokenwarned.v1',
};

const state = {
  view: 'boot',
  demo: false,
  offline: false,
  config: { ...DEFAULT_CONFIG },
  client: null,
  user: null,
  repo: null,
  posts: [],
  loadedAt: 0,
  current: null,
  saving: false,
  dirty: false,
  autosaveTimer: null,
  previewing: false,
  drafts: {},
  images: [],
  imagesLoaded: false,
};

/* ------------------------------------------------------------------ *
 * 1. 小工具
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满了都可能写不进去，忽略 */
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : String(value);
}

function toDateInput(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''));
  return match ? match[1] : '';
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '');
}

function extname(name) {
  const match = /\.[^.]+$/.exec(String(name));
  return match ? match[0] : '.md';
}

function dateValue(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function parseTagsInput(text) {
  return String(text ?? '')
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorText(error, fallback) {
  return (error && error.message) || fallback;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function syncHeaderOffset() {
  const header = document.querySelector('.topbar');
  const height = header ? header.offsetHeight : 56;
  document.documentElement.style.setProperty('--header-offset', `${height}px`);
}

/** 仓库里的路径 → 站点上的 URL（public/ 是目录名，不是网址前缀） */
function publicUrl(repoPath) {
  return `/${String(repoPath).replace(/^public\//, '')}`;
}

/* ------------------------------------------------------------------ *
 * 2. 本地存储
 * ------------------------------------------------------------------ */

function readDraftsStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEYS.drafts);
  } catch {
    raw = null;
  }
  return readDrafts(raw);
}

function writeDraftsStore(drafts) {
  state.drafts = drafts;
  writeJson(KEYS.drafts, drafts);
  if (state.view === 'list') renderDraftHint();
}

function readListCache() {
  const cache = readJson(KEYS.cache);
  return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
}

/* ------------------------------------------------------------------ *
 * 3. 视图 / 路由
 * ------------------------------------------------------------------ */

const VIEWS = {
  boot: 'view-boot',
  setup: 'view-setup',
  list: 'view-list',
  edit: 'view-edit',
  settings: 'view-settings',
};

function setView(name) {
  if (state.view !== name) window.scrollTo({ top: 0 });
  state.view = name;
  for (const [key, id] of Object.entries(VIEWS)) {
    const element = $(id);
    if (element) element.hidden = key !== name;
  }
}

function showError(id, message) {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}

function clearError(id) {
  const element = $(id);
  if (!element) return;
  element.textContent = '';
  element.hidden = true;
}

let toastTimer = 0;

function toast(message, options = {}) {
  const { type = 'ok', link } = options;
  const element = $('toast');
  element.className = `toast${type === 'error' ? ' error' : ''}`;
  element.replaceChildren();
  element.append(document.createTextNode(message));
  if (link && link.url) {
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.label || '查看';
    element.append(' ', anchor);
  }
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => {
      element.hidden = true;
    },
    type === 'error' ? 8000 : 5000
  );
}

let modalResolve = null;

function showModal(options) {
  const { title, text = '', actions = [] } = options;
  return new Promise((resolve) => {
    modalResolve = resolve;
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    const wrap = $('modal-actions');
    wrap.replaceChildren();
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn${action.kind ? ' ' + action.kind : ''}`;
      button.textContent = action.label;
      button.addEventListener('click', () => closeModal(action.value));
      wrap.append(button);
    }
    $('modal').hidden = false;
  });
}

function closeModal(value) {
  $('modal').hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  if (resolve) resolve(value);
}

function setConnected(connected, label) {
  const dot = $('conn-dot');
  dot.classList.toggle('connected', Boolean(connected));
  dot.classList.toggle('error', connected === false);
  dot.title = label || (connected ? '已连接' : '未连接');
}

async function route() {
  if (!state.client) {
    setView('setup');
    return;
  }
  const hash = location.hash || '#/';
  try {
    if (hash.startsWith('#/edit/')) {
      const slug = decodeURIComponent(hash.slice('#/edit/'.length));
      await openEditor(slug);
      return;
    }
    if (hash === '#/new') {
      openNew();
      return;
    }
    if (hash === '#/settings') {
      renderSettings();
      return;
    }
    await showList({ force: true });
  } catch (error) {
    toast(errorText(error, '页面加载失败'), { type: 'error' });
    setView('list');
  }
}

/* ------------------------------------------------------------------ *
 * 4. 连接与设置
 * ------------------------------------------------------------------ */

/**
 * 保存配置；令牌没变就沿用原来的保存时间，用来判断「这把钥匙是不是该换了」。
 */
function persistConfig(config) {
  const previous = readJson(KEYS.config) || {};
  const keptAt = previous.token && previous.token === config.token ? Number(previous.savedAt || 0) : 0;
  const next = { ...config, savedAt: keptAt || Date.now() };
  state.config = next;
  writeJson(KEYS.config, next);
  return next;
}

async function connect(config) {
  const client = createGitHubClient(config);
  const [user, repo] = await Promise.all([client.getUser(), client.getRepo()]);
  state.client = client;
  state.config = { ...config };
  state.user = user;
  state.repo = repo;
  state.imagesLoaded = false;
  setConnected(true, `${user.login} · ${repo.fullName}`);
  return { user, repo };
}

function readSetupForm() {
  const pick = (id, fallback) => {
    const element = $(id);
    const value = element ? element.value.trim() : '';
    return value || fallback;
  };
  return {
    token: $('setup-token').value.trim(),
    owner: pick('setup-owner', DEFAULT_CONFIG.owner),
    repo: pick('setup-repo', DEFAULT_CONFIG.repo),
    branch: pick('setup-branch', DEFAULT_CONFIG.branch),
    dir: pick('setup-dir', DEFAULT_CONFIG.dir),
    netlifySite: state.config.netlifySite || '',
  };
}

async function handleSetupSubmit(event) {
  event.preventDefault();
  const config = readSetupForm();
  if (!config.token) {
    showError('setup-error', '先粘贴访问令牌再点连接');
    return;
  }
  const submit = $('setup-submit');
  submit.disabled = true;
  submit.textContent = '连接中…';
  clearError('setup-error');
  try {
    await connect(config);
    persistConfig(config);
    checkTokenAge();
    await goHome();
  } catch (error) {
    showError('setup-error', errorText(error, '连接失败'));
    setConnected(false, '连接失败');
  } finally {
    submit.disabled = false;
    submit.textContent = '连接并开始';
  }
}

async function goHome() {
  if ((location.hash || '#/') === '#/') {
    await showList({ force: true });
  } else {
    location.hash = '#/';
  }
}

function deployUrl() {
  const site = String(state.config.netlifySite || '').trim();
  if (!site) return '';
  return `https://app.netlify.com/sites/${encodeURIComponent(site)}/deploys`;
}

function renderDeployLink() {
  const url = deployUrl();
  const row = $('deploy-row');
  if (!row) return;
  row.hidden = !url;
  if (url) $('deploy-link').href = url;
}

function checkTokenAge() {
  const savedAt = Number(state.config.savedAt || 0);
  if (!savedAt) return;
  const days = Math.floor((Date.now() - savedAt) / 86400000);
  if (days < TOKEN_WARN_DAYS) return;
  // 一周最多提醒一次，别每次打开都弹
  const lastWarned = Number(readJson(KEYS.tokenWarned) || 0);
  if (Date.now() - lastWarned < 7 * 86400000) return;
  writeJson(KEYS.tokenWarned, Date.now());
  toast(`令牌是 ${days} 天前保存的。细粒度令牌大多 90 天到期，建议提前去 GitHub 重新生成一个`, {
    type: 'error',
  });
}

function renderSettings() {
  setView('settings');
  const config = state.config;
  $('s-owner').value = config.owner;
  $('s-repo').value = config.repo;
  $('s-branch').value = config.branch;
  $('s-dir').value = config.dir;
  $('s-token').value = config.token;
  $('s-netlify').value = config.netlifySite || '';
  $('settings-status').textContent = state.repo ? `当前连接：${state.repo.fullName} · ${config.dir}` : '';
  renderDeployLink();
  clearError('settings-error');
}

function readSettingsForm() {
  return {
    token: $('s-token').value.trim(),
    owner: $('s-owner').value.trim(),
    repo: $('s-repo').value.trim(),
    branch: $('s-branch').value.trim() || 'main',
    dir: $('s-dir').value.trim() || DEFAULT_CONFIG.dir,
    netlifySite: $('s-netlify').value.trim(),
  };
}

async function testSettings() {
  const config = readSettingsForm();
  if (!config.token || !config.owner || !config.repo) {
    showError('settings-error', '令牌、owner、仓库名都不能为空');
    return;
  }
  const button = $('btn-test');
  button.disabled = true;
  $('settings-status').textContent = '正在测试…';
  clearError('settings-error');
  try {
    const client = createGitHubClient(config);
    const [user, repo, files] = await Promise.all([client.getUser(), client.getRepo(), client.listFiles(config.dir)]);
    $('settings-status').textContent = `连接正常：${user.login} · ${repo.fullName} · 分支 ${config.branch} · 目录下 ${files.length} 篇文章`;
  } catch (error) {
    showError('settings-error', errorText(error, '连接失败'));
    $('settings-status').textContent = '';
  } finally {
    button.disabled = false;
  }
}

async function saveSettings() {
  const config = readSettingsForm();
  if (!config.token || !config.owner || !config.repo) {
    showError('settings-error', '令牌、owner、仓库名都不能为空');
    return;
  }
  const button = $('btn-save-settings');
  button.disabled = true;
  clearError('settings-error');
  try {
    await connect(config);
    persistConfig(config);
    toast('设置已保存');
    location.hash = '#/';
  } catch (error) {
    showError('settings-error', errorText(error, '保存失败'));
  } finally {
    button.disabled = false;
  }
}

async function disconnect() {
  const confirmed = await showModal({
    title: '断开连接？',
    text: '只会清掉这台设备上保存的令牌，仓库里的文章和本机草稿都不受影响。',
    actions: [
      { label: '取消', value: false },
      { label: '断开', value: true, kind: 'danger' },
    ],
  });
  if (!confirmed) return;
  removeKey(KEYS.config);
  state.client = null;
  state.user = null;
  state.repo = null;
  state.posts = [];
  state.images = [];
  state.imagesLoaded = false;
  state.config = { ...DEFAULT_CONFIG };
  setConnected(false, '未连接');
  $('setup-token').value = '';
  setView('setup');
  history.replaceState(null, '', '/admin/');
}

/* ------------------------------------------------------------------ *
 * 5. 列表
 * ------------------------------------------------------------------ */

function sortPosts(posts) {
  return [...posts].sort((a, b) => {
    const pinnedA = a.frontmatter && a.frontmatter.pinned ? 1 : 0;
    const pinnedB = b.frontmatter && b.frontmatter.pinned ? 1 : 0;
    if (pinnedA !== pinnedB) return pinnedB - pinnedA;
    return dateValue(b.frontmatter && b.frontmatter.pubDate) - dateValue(a.frontmatter && a.frontmatter.pubDate);
  });
}

async function showList(options = {}) {
  const { force = false } = options;
  setView('list');
  if (force || state.posts.length === 0) await loadPosts();
  renderPosts();
  renderDraftHint();
}

/**
 * 读文章列表。
 * 1) 先用 sha 对比本地缓存：文件没变就不重新拉正文，手机上刷新快很多；
 * 2) 只有变化的文件才 getFile（并发 8）；
 * 3) 正文不进缓存，打开编辑器时单独取最新版本，顺便避免用过期的 sha 覆盖别人。
 */
async function loadPosts() {
  clearError('list-error');
  $('list-meta').textContent = '正在读取仓库…';
  $('post-list').replaceChildren();
  try {
    const files = await state.client.listFiles(state.config.dir);
    const cache = readListCache();
    const nextCache = {};

    const posts = await mapLimit(files, 8, async (file) => {
      const hit = cache[file.path];
      if (hit && hit.sha === file.sha && hit.frontmatter) {
        nextCache[file.path] = hit;
        return { file, sha: file.sha, frontmatter: hit.frontmatter, extras: hit.extras || [], body: '', cached: true };
      }
      try {
        const data = await state.client.getFile(file.path);
        const parsed = parsePost(data.text);
        nextCache[file.path] = { sha: data.sha, frontmatter: parsed.frontmatter, extras: parsed.extras };
        return { file, sha: data.sha, frontmatter: parsed.frontmatter, extras: parsed.extras, body: parsed.body };
      } catch (error) {
        return { file, sha: file.sha, frontmatter: {}, extras: [], body: '', error };
      }
    });

    state.posts = posts;
    state.loadedAt = Date.now();
    writeJson(KEYS.cache, nextCache);
    const failed = posts.filter((post) => post.error).length;
    $('list-meta').textContent = `共 ${posts.length} 篇${failed ? ' · ' + failed + ' 篇读取失败' : ''} · ${formatDateTime(state.loadedAt)} 更新`;
  } catch (error) {
    state.posts = [];
    showError('list-error', errorText(error, '读取文章列表失败'));
    $('list-meta').textContent = '';
  }
  renderSuggestions();
}

function fillDatalist(id, values) {
  const list = $(id);
  if (!list) return;
  list.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    list.append(option);
  }
}

/** 把已有的分类 / 标签 / 专栏汇总成输入提示，避免手打出一堆同义标签 */
function renderSuggestions() {
  const tags = new Set();
  const categories = new Set();
  const series = new Set();
  for (const post of state.posts) {
    const fm = post.frontmatter || {};
    if (fm.category) categories.add(String(fm.category));
    if (fm.series) series.add(String(fm.series));
    for (const tag of Array.isArray(fm.tags) ? fm.tags : []) {
      if (tag) tags.add(String(tag));
    }
  }
  fillDatalist('dl-tags', [...tags].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
  fillDatalist('dl-category', [...categories].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
  fillDatalist('dl-series', [...series].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
}

function renderDraftHint() {
  const wrap = $('draft-hint');
  const list = $('draft-list');
  if (!wrap || !list) return;

  const drafts = listDrafts(state.drafts || readDraftsStore());
  list.replaceChildren();
  wrap.hidden = drafts.length === 0;
  if (drafts.length === 0) return;

  for (const draft of drafts) {
    const item = document.createElement('li');
    item.className = 'draft-item';

    const info = document.createElement('div');
    info.className = 'draft-info';
    const title = document.createElement('strong');
    title.textContent = draft.title;
    const meta = document.createElement('span');
    const kind = draft.remoteBackup ? '保存时留下的远端版本' : draft.isNew ? '新文章' : '修改';
    meta.textContent = `${kind} · ${draft.chars} 字 · ${formatDateTime(draft.savedAt)}`;
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn small';
    open.textContent = '继续写';
    open.addEventListener('click', () => openDraft(draft));

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'btn small ghost';
    drop.textContent = '丢弃';
    drop.addEventListener('click', () => dropDraft(draft));

    actions.append(open, drop);
    item.append(info, actions);
    list.append(item);
  }
}

function openDraft(draft) {
  if (draft.key === NEW_DRAFT_KEY) {
    location.hash = '#/new';
    return;
  }
  location.hash = `#/edit/${encodeURIComponent(draft.key)}`;
}

async function dropDraft(draft) {
  const confirmed = await showModal({
    title: '丢弃这份草稿？',
    text: `「${draft.title}」在本机保存的 ${draft.chars} 字将被删除，仓库里的文章不受影响。`,
    actions: [
      { label: '取消', value: false },
      { label: '丢弃', value: true, kind: 'danger' },
    ],
  });
  if (!confirmed) return;
  writeDraftsStore(removeDraft(readDraftsStore(), draft.key));
  renderDraftHint();
  toast('草稿已丢弃');
}

async function clearAllDrafts() {
  const drafts = listDrafts(readDraftsStore());
  if (drafts.length === 0) return;
  const confirmed = await showModal({
    title: '丢弃全部本机草稿？',
    text: `共 ${drafts.length} 份未保存的草稿会被删除，仓库里的文章不受影响。`,
    actions: [
      { label: '取消', value: false },
      { label: '全部丢弃', value: true, kind: 'danger' },
    ],
  });
  if (!confirmed) return;
  writeDraftsStore({});
  renderDraftHint();
  toast('本机草稿已清空');
}

function renderPosts() {
  const keyword = $('search').value.trim().toLowerCase();
  const list = $('post-list');
  list.replaceChildren();

  const filtered = sortPosts(state.posts).filter((post) => {
    if (!keyword) return true;
    const fm = post.frontmatter || {};
    const haystack = [fm.title, fm.description, fm.category, fm.series, ...(Array.isArray(fm.tags) ? fm.tags : []), post.file.name]
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  });

  for (const post of filtered) {
    const fm = post.frontmatter || {};
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'post-item';
    link.href = `#/edit/${encodeURIComponent(baseName(post.file.name))}`;

    const title = document.createElement('h3');
    title.textContent = fm.title || post.file.name;
    link.append(title);

    if (fm.description) {
      const description = document.createElement('p');
      description.className = 'post-desc';
      description.textContent = fm.description;
      link.append(description);
    }

    const meta = document.createElement('div');
    meta.className = 'post-meta';

    const date = document.createElement('span');
    date.textContent = formatDate(fm.pubDate) || '未填日期';
    meta.append(date);

    if (fm.category) {
      const category = document.createElement('span');
      category.className = 'tag';
      category.textContent = '# ' + fm.category;
      meta.append(category);
    }

    for (const tag of (Array.isArray(fm.tags) ? fm.tags : []).slice(0, 3)) {
      const tagElement = document.createElement('span');
      tagElement.className = 'tag';
      tagElement.textContent = tag;
      meta.append(tagElement);
    }

    if (fm.draft) {
      const badge = document.createElement('span');
      badge.className = 'badge draft';
      badge.textContent = '草稿';
      meta.append(badge);
    }
    if (fm.pinned) {
      const badge = document.createElement('span');
      badge.className = 'badge pinned';
      badge.textContent = '置顶';
      meta.append(badge);
    }
    if (post.error) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.style.color = 'var(--danger)';
      badge.textContent = '读取失败';
      meta.append(badge);
    }

    link.append(meta);
    item.append(link);
    list.append(item);
  }

  $('list-empty').hidden = filtered.length > 0 || state.posts.length > 0;
}

/* ------------------------------------------------------------------ *
 * 6. 编辑器
 * ------------------------------------------------------------------ */

function updateEditorChrome() {
  const current = state.current;
  if (!current) return;
  const status = $('editor-status');
  if (current.isNew) {
    status.textContent = state.dirty ? '新文章 · 未保存' : '新文章';
  } else {
    status.textContent = state.dirty ? `${current.file.name} · 未保存` : current.file.name;
  }
  $('btn-delete').hidden = current.isNew;
  $('btn-view-file').hidden = current.isNew || state.demo;
}

function updateWordCount() {
  const body = $('f-body').value;
  $('word-count').textContent = `${countWords(body)} 字`;
  if (state.previewing) $('preview').innerHTML = renderMarkdown(body);
}

function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    updateEditorChrome();
  }
  updateWordCount();
  scheduleAutosave();
}

function fillForm(options) {
  const { isNew, post } = options;
  const fm = isNew ? {} : post.frontmatter || {};
  $('f-title').value = fm.title || '';
  $('f-desc').value = fm.description || '';
  $('f-pubdate').value = toDateInput(fm.pubDate) || (isNew ? todayISO() : '');
  $('f-updated').value = toDateInput(fm.updatedDate);
  $('f-category').value = fm.category || '';
  $('f-tags').value = Array.isArray(fm.tags) ? fm.tags.join(', ') : '';
  $('f-series').value = fm.series || '';
  $('f-cover').value = fm.cover || '';
  $('f-link').value = fm.link || '';
  $('f-subtitle').value = fm.subtitle || '';
  $('f-slug').value = isNew ? '' : baseName(post.file.name);
  $('f-draft').checked = isNew ? true : Boolean(fm.draft);
  $('f-pinned').checked = Boolean(fm.pinned);
  $('f-body').value = isNew ? '' : post.body || '';
  $('more-fields').open = false;
  $('cover-status').textContent = '';
  clearError('save-error');
  exitPreview();

  state.current = {
    isNew,
    file: isNew ? null : post.file,
    extras: isNew ? [] : post.extras || [],
    originalPubDate: fm.pubDate || null,
    originalUpdatedDate: fm.updatedDate || null,
    slug: isNew ? '' : baseName(post.file.name),
    ext: isNew ? '.md' : extname(post.file.name),
  };
  state.dirty = false;
  updateEditorChrome();
  updateWordCount();
}

function openNew() {
  setView('edit');
  fillForm({ isNew: true });
  $('f-title').focus();
  restoreAutosaveIfAny();
}

async function openEditor(slug) {
  setView('edit');
  let post = state.posts.find((item) => baseName(item.file.name) === slug);
  if (!post) {
    await loadPosts();
    post = state.posts.find((item) => baseName(item.file.name) === slug);
  }
  if (!post) {
    // 仓库里没有这篇，但本机可能还留着它的草稿（比如被别人删了）
    const snapshot = pickDraft(readDraftsStore(), draftKeyForSlug(slug));
    if (snapshot) {
      fillForm({ isNew: true });
      state.current.slug = slug;
      applySnapshot(snapshot);
      $('f-slug').value = snapshot.slug || slug;
      toast('仓库里没有这篇文章了，已按本机草稿打开；保存会重新创建它');
      return;
    }
    toast('找不到这篇文章，可能已经被删除了', { type: 'error' });
    location.hash = '#/';
    return;
  }

  // 重新拉一次正文：拿到最新 sha，既不会用过期版本覆盖别人，也能看到别处的修改
  try {
    $('editor-status').textContent = '读取中…';
    const fresh = await state.client.getFile(post.file.path);
    const parsed = parsePost(fresh.text);
    post = {
      file: { ...post.file, sha: fresh.sha, size: fresh.size },
      sha: fresh.sha,
      frontmatter: parsed.frontmatter,
      extras: parsed.extras,
      body: parsed.body,
    };
  } catch (error) {
    // 拿不到正文时千万别让人接着编辑：空正文一保存就把原文覆盖了
    if (!post.body) {
      toast(`读取正文失败：${errorText(error, '网络或权限问题')}。先不打开编辑器，避免把原文覆盖成空白`, {
        type: 'error',
      });
      location.hash = '#/';
      return;
    }
    toast(`读取最新正文失败，先用手上的版本：${errorText(error, '')}`, { type: 'error' });
  }

  fillForm({ isNew: false, post });
  restoreAutosaveIfAny();
}

function resolvePubDate() {
  const input = $('f-pubdate').value;
  const current = state.current;
  const original = String((current && current.originalPubDate) || '');
  if (!input) return original || todayISO();
  if (original && original.startsWith(input)) return original;
  return input;
}

function resolveUpdatedDate() {
  const input = $('f-updated').value;
  if (!input) return null;
  const original = String((state.current && state.current.originalUpdatedDate) || '');
  if (original && original.startsWith(input)) return original;
  return input;
}

function collectFrontmatter() {
  const title = $('f-title').value.trim();
  const description = $('f-desc').value.trim();
  const category = $('f-category').value.trim();
  const series = $('f-series').value.trim();
  const cover = $('f-cover').value.trim();
  const link = $('f-link').value.trim();
  const subtitle = $('f-subtitle').value.trim();
  const tags = parseTagsInput($('f-tags').value);

  const frontmatter = {
    title,
    description,
    pubDate: resolvePubDate(),
  };
  const updatedDate = resolveUpdatedDate();
  if (updatedDate) frontmatter.updatedDate = updatedDate;
  if (category) frontmatter.category = category;
  if (tags.length) frontmatter.tags = tags;
  if (series) frontmatter.series = series;
  if ($('f-draft').checked) frontmatter.draft = true;
  if ($('f-pinned').checked) frontmatter.pinned = true;
  if (cover) frontmatter.cover = cover;
  if (subtitle) frontmatter.subtitle = subtitle;
  if (link) frontmatter.link = link;
  return frontmatter;
}

function resolveSlug() {
  const typed = $('f-slug').value.trim();
  if (typed) return typed;
  if (state.current && state.current.slug) return state.current.slug;
  return defaultSlug($('f-title').value || 'post');
}

function setSaving(saving) {
  state.saving = saving;
  const button = $('btn-save');
  button.disabled = saving;
  button.textContent = saving ? '保存中…' : '保存';
}

async function afterSave(result, options) {
  clearAutosave();
  state.dirty = false;
  const link = result && result.commitUrl ? { url: result.commitUrl, label: '查看提交' } : undefined;
  toast(`已提交《${options.title}》到 GitHub，Netlify 大约 1 分钟后更新站点`, { link });
  if ((location.hash || '#/') === '#/') await showList({ force: true });
  else location.hash = '#/';
}

async function savePost(event) {
  if (event) event.preventDefault();
  if (state.saving || !state.client) return;
  clearError('save-error');
  updateWordCount();

  const frontmatter = collectFrontmatter();
  const errors = validateFrontmatter(frontmatter);
  if (errors.length) {
    showError('save-error', errors.join('\n'));
    return;
  }

  const slug = resolveSlug();
  if (!isValidSlug(slug)) {
    showError('save-error', '文件名不合法：只能用文字、数字和连字符，不能有空格、点或斜杠');
    return;
  }

  const current = state.current;
  const ext = current.ext || '.md';
  const path = `${state.config.dir}/${slug}${ext}`;
  const renamed = !current.isNew && current.slug !== slug;

  if ((current.isNew || renamed) && state.posts.some((post) => post.file.path === path)) {
    showError('save-error', `已经有一篇文章用 ${slug} 这个文件名了，换一个吧`);
    return;
  }

  const body = $('f-body').value;
  const source = serializePost({ frontmatter, extras: current.extras, body });
  const message = current.isNew ? `post: 新增《${frontmatter.title}》` : `post: 更新《${frontmatter.title}》`;

  setSaving(true);
  try {
    if (current.isNew) {
      const result = await state.client.putFile(path, source, { message });
      await afterSave(result, { title: frontmatter.title });
    } else if (renamed) {
      const result = await renamePost({ source, path, title: frontmatter.title });
      if (result) await afterSave(result, { title: frontmatter.title });
    } else {
      const result = await state.client.putFile(path, source, { message, sha: current.file.sha });
      await afterSave(result, { title: frontmatter.title });
    }
  } catch (error) {
    if (error instanceof GitHubError && error.status === 409) {
      await handleConflict({ path, source, message });
    } else if (error instanceof GitHubError && error.status === 0) {
      // 断网：先把内容落到本机草稿，别让手机上写的一段话白费
      if (persistAutosave()) {
        toast('网络不通，内容已存成本机草稿；联网后打开这篇点「恢复」就能接着提交', { type: 'error' });
      } else {
        toast(errorText(error, '网络不通，保存失败'), { type: 'error' });
      }
      showError('save-error', errorText(error, '保存失败'));
    } else {
      showError('save-error', errorText(error, '保存失败'));
      toast(errorText(error, '保存失败'), { type: 'error' });
    }
  } finally {
    setSaving(false);
  }
}

/**
 * 重命名：新路径写入 + 旧路径删除放在同一个 commit 里，
 * 失败不会留下「两个文件都在」的残骸。
 */
async function renamePost(options) {
  const { source, path, title } = options;
  const current = state.current;

  let latest = null;
  try {
    latest = await state.client.getFile(current.file.path);
  } catch {
    latest = null;
  }
  if (latest && latest.sha !== current.file.sha) {
    const confirmed = await showModal({
      title: '文件在别处被修改过',
      text: '重命名会删掉仓库里的旧文件，那边的修改会一起消失。继续吗？',
      actions: [
        { label: '取消', value: false },
        { label: '仍然重命名', value: true, kind: 'danger' },
      ],
    });
    if (!confirmed) {
      showError('save-error', '没有重命名：文件已有更新版本，建议返回刷新后再改');
      return null;
    }
  }

  const result = await state.client.commitFiles(
    [
      { path, text: source },
      { path: current.file.path, delete: true },
    ],
    { message: `post: 重命名《${title}》` }
  );
  state.posts = state.posts.map((post) =>
    post.file.path === current.file.path
      ? { ...post, file: { ...post.file, path, name: String(path).split('/').pop() } }
      : post
  );
  return result;
}

async function handleConflict(options) {
  const { path, source, message } = options;
  const choice = await showModal({
    title: '文件在别处被修改过',
    text: '这个文件已经被另一台设备或网页改过。要用你屏幕上的版本覆盖吗？覆盖前会把远端版本留一份在本机草稿里。',
    actions: [
      { label: '取消', value: null },
      { label: '用我的版本覆盖', value: 'overwrite', kind: 'primary' },
    ],
  });
  if (choice !== 'overwrite') {
    showError('save-error', '没有保存：文件已有更新版本，建议返回刷新后再改');
    return;
  }
  try {
    const latest = await state.client.getFile(path);
    const result = await state.client.putFile(path, source, { message, sha: latest.sha });
    const title = collectFrontmatter().title;
    const key = draftKeyForSlug(state.current && state.current.slug ? state.current.slug : baseName(path));
    await afterSave(result, { title });
    // afterSave 会清掉当前槽位，所以备份要写在后面
    const snapshot = snapshotFromSource(key, latest.text, {
      title: `（远端版本）${title}`,
      remoteBackup: true,
    });
    writeDraftsStore(putDraft(readDraftsStore(), key, snapshot));
    toast('已用你的版本覆盖；远端旧版本留在了本机草稿里，列表页可以看到', {
      link: result && result.commitUrl ? { url: result.commitUrl, label: '查看提交' } : undefined,
    });
  } catch (error) {
    showError('save-error', errorText(error, '覆盖失败'));
  }
}

async function deleteCurrentPost() {
  if (!state.current || state.current.isNew) return;
  const title = $('f-title').value.trim() || baseName(state.current.file.name);
  const confirmed = await showModal({
    title: '删除这篇文章？',
    text: `将删除 ${state.current.file.path}。Git 历史里还能找回，但站点上会立刻消失（重新构建后）。本机草稿会一起清掉。`,
    actions: [
      { label: '取消', value: false },
      { label: '删除', value: true, kind: 'danger' },
    ],
  });
  if (!confirmed) return;
  setSaving(true);
  clearError('save-error');
  try {
    const result = await state.client.deleteFile(state.current.file.path, {
      message: `post: 删除《${title}》`,
      sha: state.current.file.sha,
    });
    clearAutosave();
    state.dirty = false;
    const link = result && result.commitUrl ? { url: result.commitUrl, label: '查看提交' } : undefined;
    toast(`已删除《${title}》，Netlify 大约 1 分钟后更新站点`, { link });
    location.hash = '#/';
  } catch (error) {
    showError('save-error', errorText(error, '删除失败'));
  } finally {
    setSaving(false);
  }
}

async function goBackFromEditor() {
  if (state.dirty) {
    const choice = await showModal({
      title: '还有没保存的修改',
      text: '返回列表会先在本机留一份草稿，下次打开这篇还能恢复。',
      actions: [
        { label: '留在这里', value: null },
        { label: '返回列表', value: 'back', kind: 'primary' },
      ],
    });
    if (choice !== 'back') return;
    persistAutosave();
  }
  location.hash = '#/';
}

/* ---------- 图片 ---------- */

async function uploadImage(file) {
  if (!file) return null;
  const compressed = await compressImage(file);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const filename = `${Date.now()}-${safeAssetName(file.name, 'image')}.${compressed.ext}`;
  const repoPath = `${UPLOADS_DIR}/${month}/${filename}`;
  await state.client.putBinary(repoPath, compressed.base64, {
    message: `assets: 上传图片 ${filename}`,
  });
  state.imagesLoaded = false;
  return { url: publicUrl(repoPath), path: repoPath, bytes: compressed.bytes };
}

async function handleBodyImage(file) {
  if (!file || !state.client) return;
  toast('正在压缩并上传图片…');
  try {
    const uploaded = await uploadImage(file);
    if (!uploaded) return;
    insertText(`\n\n![${String(file.name).replace(/\.[^.]+$/, '')}](${uploaded.url})\n\n`);
    toast(`图片已上传（${formatBytes(uploaded.bytes)}）`);
  } catch (error) {
    toast(errorText(error, '图片上传失败'), { type: 'error' });
  }
}

async function handleCoverImage(file) {
  if (!file || !state.client) return;
  const status = $('cover-status');
  status.textContent = '上传中…';
  try {
    const uploaded = await uploadImage(file);
    if (!uploaded) return;
    $('f-cover').value = uploaded.url;
    status.textContent = `已上传 · ${formatBytes(uploaded.bytes)}`;
    markDirty();
    toast('封面已上传');
  } catch (error) {
    status.textContent = '';
    toast(errorText(error, '封面图上传失败'), { type: 'error' });
  }
}

/* ---------- 插入 Markdown ---------- */

function insertText(text) {
  const textarea = $('f-body');
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.focus();
  textarea.setRangeText(text, start, end, 'end');
  markDirty();
}

function insertTemplate(name) {
  const textarea = $('f-body');
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const selected = textarea.value.slice(start, end);

  const templates = {
    heading: { before: '## ', after: '', placeholder: '小标题' },
    bold: { before: '**', after: '**', placeholder: '粗体' },
    italic: { before: '*', after: '*', placeholder: '斜体' },
    list: { before: '- ', after: '', placeholder: '列表项' },
    quote: { before: '> ', after: '', placeholder: '引用' },
    code: { before: '```\n', after: '\n```', placeholder: '代码' },
    link: { before: '[', after: '](https://)', placeholder: '链接文字' },
    hr: { before: '\n\n---\n\n', after: '', placeholder: '' },
  };

  const template = templates[name];
  if (!template) return;
  const text = selected || template.placeholder;
  const insert = template.before + text + template.after;
  textarea.focus();
  textarea.setRangeText(insert, start, end, 'end');
  if (!selected && template.placeholder) {
    textarea.selectionStart = start + template.before.length;
    textarea.selectionEnd = start + template.before.length + template.placeholder.length;
  }
  markDirty();
}

/* ---------- 预览 ---------- */

function enterPreview() {
  $('preview').innerHTML = renderMarkdown($('f-body').value);
  $('preview').hidden = false;
  $('f-body').hidden = true;
  $('btn-preview').textContent = '继续写';
  state.previewing = true;
}

function exitPreview() {
  $('preview').hidden = true;
  $('f-body').hidden = false;
  $('btn-preview').textContent = '预览';
  state.previewing = false;
}

function togglePreview() {
  if (state.previewing) exitPreview();
  else enterPreview();
}

/* ---------- 自动草稿（按文章分槽位） ---------- */

function autosaveKeyForCurrent() {
  if (!state.current) return '';
  return draftKeyForSlug(state.current.isNew ? NEW_DRAFT_KEY : state.current.slug);
}

function collectSnapshot() {
  return {
    key: autosaveKeyForCurrent(),
    savedAt: Date.now(),
    isNew: Boolean(state.current && state.current.isNew),
    title: $('f-title').value,
    description: $('f-desc').value,
    pubdate: $('f-pubdate').value,
    updated: $('f-updated').value,
    category: $('f-category').value,
    tags: $('f-tags').value,
    series: $('f-series').value,
    cover: $('f-cover').value,
    link: $('f-link').value,
    subtitle: $('f-subtitle').value,
    slug: $('f-slug').value,
    draft: $('f-draft').checked,
    pinned: $('f-pinned').checked,
    body: $('f-body').value,
  };
}

/** 立刻把当前编辑器内容写进本机草稿；返回是否真的写成功 */
function persistAutosave() {
  if (state.demo || state.view !== 'edit' || !state.current) return false;
  const key = autosaveKeyForCurrent();
  if (!key) return false;
  writeDraftsStore(putDraft(readDraftsStore(), key, collectSnapshot()));
  return true;
}

function scheduleAutosave() {
  if (state.demo) return;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = window.setTimeout(persistAutosave, 700);
}

function clearAutosave(key) {
  clearTimeout(state.autosaveTimer);
  const slot = key || autosaveKeyForCurrent();
  if (!slot) return;
  writeDraftsStore(removeDraft(readDraftsStore(), slot));
}

function applySnapshot(snapshot) {
  $('f-title').value = snapshot.title || '';
  $('f-desc').value = snapshot.description || '';
  $('f-pubdate').value = snapshot.pubdate || '';
  $('f-updated').value = snapshot.updated || '';
  $('f-category').value = snapshot.category || '';
  $('f-tags').value = snapshot.tags || '';
  $('f-series').value = snapshot.series || '';
  $('f-cover').value = snapshot.cover || '';
  $('f-link').value = snapshot.link || '';
  $('f-subtitle').value = snapshot.subtitle || '';
  $('f-slug').value = snapshot.slug || '';
  $('f-draft').checked = Boolean(snapshot.draft);
  $('f-pinned').checked = Boolean(snapshot.pinned);
  $('f-body').value = snapshot.body || '';
  state.dirty = true;
  updateEditorChrome();
  updateWordCount();
}

async function restoreAutosaveIfAny() {
  if (state.demo) return;
  const key = autosaveKeyForCurrent();
  const snapshot = pickDraft(readDraftsStore(), key);
  if (!snapshot) return;

  const same =
    snapshot.title === $('f-title').value &&
    snapshot.body === $('f-body').value &&
    snapshot.slug === $('f-slug').value &&
    snapshot.description === $('f-desc').value;
  if (same) {
    clearAutosave(key); // 和仓库里的内容一致，这份草稿已经没用了
    return;
  }

  const restore = await showModal({
    title: snapshot.remoteBackup ? '本机留着一份远端旧版本' : '有未保存的本地草稿',
    text: snapshot.remoteBackup
      ? `${formatDateTime(snapshot.savedAt)} 覆盖保存时留下的远端内容。恢复会用它的文字替换当前编辑器里的内容。`
      : `${formatDateTime(snapshot.savedAt)} 自动保存的内容，可能比仓库里的新。恢复吗？`,
    actions: [
      { label: '丢弃', value: false },
      { label: '恢复', value: true, kind: 'primary' },
    ],
  });
  if (restore) applySnapshot(snapshot);
  else clearAutosave(key);
}

/* ------------------------------------------------------------------ *
 * 7. 图片库
 * ------------------------------------------------------------------ */

function renderLibrary() {
  const grid = $('library-grid');
  const list = state.images;
  grid.replaceChildren();
  $('library-empty').hidden = list.length > 0;
  $('library-status').textContent = list.length
    ? `共 ${list.length} 张 · 都在 ${UPLOADS_DIR}/ 下，点「插入正文」会把标记写到光标处`
    : '';

  for (const image of list) {
    const url = publicUrl(image.path);
    const item = document.createElement('div');
    item.className = 'image-item';

    const img = document.createElement('img');
    img.className = 'image-thumb';
    img.loading = 'lazy';
    img.src = url;
    img.alt = image.name;

    const body = document.createElement('div');
    body.className = 'image-item-body';

    const name = document.createElement('span');
    name.className = 'image-name';
    name.textContent = `${image.name} · ${formatBytes(image.size)}`;

    const buttons = document.createElement('div');
    buttons.className = 'image-btns';

    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'btn small';
    insert.textContent = '插入正文';
    insert.addEventListener('click', () => {
      closeLibrary();
      insertText(`\n\n![](${url})\n\n`);
      toast('已插入图片标记');
    });

    const cover = document.createElement('button');
    cover.type = 'button';
    cover.className = 'btn small';
    cover.textContent = '设为封面';
    cover.addEventListener('click', () => {
      $('f-cover').value = url;
      markDirty();
      closeLibrary();
      toast('已设为封面图');
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteLibraryImage(image));

    buttons.append(insert, cover, remove);
    body.append(name, buttons);
    item.append(img, body);
    grid.append(item);
  }
}

async function openLibrary() {
  if (!state.client) return;
  $('library').hidden = false;
  clearError('library-error');
  $('library-grid').replaceChildren();
  $('library-empty').hidden = true;

  if (state.imagesLoaded) {
    renderLibrary();
    return;
  }
  $('library-status').textContent = '正在读取 public/uploads …';
  try {
    const files = await state.client.listTree(UPLOADS_DIR);
    state.images = files.filter((file) => IMAGE_RE.test(file.path));
    state.imagesLoaded = true;
    renderLibrary();
  } catch (error) {
    $('library-status').textContent = '';
    showError('library-error', errorText(error, '读取图片列表失败'));
  }
}

function closeLibrary() {
  $('library').hidden = true;
}

async function refreshLibrary() {
  state.imagesLoaded = false;
  $('library-status').textContent = '刷新中…';
  try {
    const files = await state.client.listTree(UPLOADS_DIR);
    state.images = files.filter((file) => IMAGE_RE.test(file.path));
    state.imagesLoaded = true;
    clearError('library-error');
    renderLibrary();
  } catch (error) {
    showError('library-error', errorText(error, '刷新失败'));
  }
}

async function deleteLibraryImage(image) {
  const confirmed = await showModal({
    title: '删除这张图片？',
    text: `${image.path} 会从仓库删掉。已经发布、引用它的文章会显示不出图（Git 历史里还能找回）。`,
    actions: [
      { label: '取消', value: false },
      { label: '删除', value: true, kind: 'danger' },
    ],
  });
  if (!confirmed) return;
  $('library-status').textContent = '正在删除…';
  try {
    await state.client.commitFiles([{ path: image.path, delete: true }], {
      message: `assets: 删除图片 ${image.name}`,
    });
    state.images = state.images.filter((item) => item.path !== image.path);
    renderLibrary();
    toast('图片已删除');
  } catch (error) {
    showError('library-error', errorText(error, '删除图片失败'));
  }
}

async function handleLibraryUpload(files) {
  if (!files || files.length === 0) return;
  $('library-status').textContent = `正在上传 ${files.length} 张图片…`;
  let done = 0;
  for (const file of files) {
    try {
      await uploadImage(file);
      done += 1;
    } catch (error) {
      showError('library-error', errorText(error, '图片上传失败'));
    }
  }
  await refreshLibrary();
  if (done > 0) toast(`已上传 ${done} 张图片`);
}

/* ---------- 粘贴 / 拖拽多图 ---------- */

function imageFilesFrom(dataTransfer) {
  if (!dataTransfer) return [];
  const files = [...(dataTransfer.files || [])];
  if (files.length === 0 && dataTransfer.items) {
    for (const item of dataTransfer.items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files.filter((file) => file && file.type && file.type.startsWith('image/'));
}

/* ------------------------------------------------------------------ *
 * 8. 主题 / 事件绑定 / 启动
 * ------------------------------------------------------------------ */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('btn-theme').textContent = theme === 'light' ? '☀' : '◐';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', theme === 'light' ? '#fcfcfb' : '#0a0c10');
  try {
    localStorage.setItem(KEYS.theme, theme);
  } catch {
    /* ignore */
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {
    /* 注册失败也不影响写作 */
  });
}

function bindEvents() {
  $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-settings').addEventListener('click', () => {
    if (state.client) location.hash = '#/settings';
  });
  $('setup-form').addEventListener('submit', handleSetupSubmit);

  $('btn-refresh').addEventListener('click', () => {
    loadPosts()
      .then(() => {
        renderPosts();
        renderDraftHint();
      })
      .catch((error) => toast(errorText(error, '刷新失败'), { type: 'error' }));
  });
  $('btn-new').addEventListener('click', () => {
    location.hash = '#/new';
  });
  $('search').addEventListener('input', renderPosts);
  $('btn-clear-drafts').addEventListener('click', clearAllDrafts);

  $('edit-form').addEventListener('submit', savePost);
  $('btn-back').addEventListener('click', goBackFromEditor);
  $('btn-preview').addEventListener('click', togglePreview);
  $('btn-delete').addEventListener('click', deleteCurrentPost);
  $('btn-view-file').addEventListener('click', () => {
    if (!state.current || !state.current.file) return;
    const url = `https://github.com/${state.config.owner}/${state.config.repo}/blob/${state.config.branch}/${state.current.file.path}`;
    window.open(url, '_blank', 'noopener');
  });

  $('edit-form').addEventListener('input', () => {
    markDirty();
  });
  $('edit-form').addEventListener('change', (event) => {
    if (event.target && ['f-draft', 'f-pinned'].includes(event.target.id)) markDirty();
  });

  for (const button of document.querySelectorAll('[data-insert]')) {
    button.addEventListener('click', () => {
      const name = button.dataset.insert;
      if (name === 'image') {
        $('image-file').click();
        return;
      }
      insertTemplate(name);
    });
  }

  $('image-file').addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    for (const file of files) await handleBodyImage(file);
  });
  $('cover-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    await handleCoverImage(file);
  });
  $('btn-cover-upload').addEventListener('click', () => $('cover-file').click());

  // 手机相册之外的两条快捷路径：剪贴板粘贴、桌面拖进来
  const bodyArea = $('f-body');
  bodyArea.addEventListener('paste', async (event) => {
    const images = imageFilesFrom(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    for (const file of images) await handleBodyImage(file);
  });
  for (const type of ['dragenter', 'dragover']) {
    bodyArea.addEventListener(type, (event) => {
      if (imageFilesFrom(event.dataTransfer).length > 0) event.preventDefault();
    });
  }
  bodyArea.addEventListener('drop', async (event) => {
    const images = imageFilesFrom(event.dataTransfer);
    if (images.length === 0) return;
    event.preventDefault();
    for (const file of images) await handleBodyImage(file);
  });

  $('btn-library').addEventListener('click', openLibrary);
  $('btn-library-close').addEventListener('click', closeLibrary);
  $('btn-library-upload').addEventListener('click', () => $('library-file').click());
  $('library-file').addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    await handleLibraryUpload(files);
  });
  $('library').addEventListener('click', (event) => {
    if (event.target === $('library')) closeLibrary();
  });

  $('btn-test').addEventListener('click', testSettings);
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('btn-disconnect').addEventListener('click', disconnect);

  $('modal').addEventListener('click', (event) => {
    if (event.target === $('modal')) closeModal(null);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('library').hidden) closeLibrary();
      else if (!$('modal').hidden) closeModal(null);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (state.view === 'edit') savePost(event);
    }
  });

  window.addEventListener('resize', syncHeaderOffset);
  window.addEventListener('hashchange', () => {
    route().catch((error) => toast(errorText(error, '页面加载失败'), { type: 'error' }));
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.view === 'edit' && state.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  const updateOnline = () => {
    state.offline = !navigator.onLine;
    $('offline-banner').hidden = navigator.onLine;
  };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

async function boot() {
  syncHeaderOffset();
  state.drafts = readDraftsStore();
  bindEvents();
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  registerServiceWorker();

  const demo = new URLSearchParams(location.search).get('demo') === '1';
  if (demo) {
    state.demo = true;
    state.config = { ...DEFAULT_CONFIG };
    state.client = createDemoClient();
    $('demo-banner').hidden = false;
    setConnected(true, '演示模式');
    await route();
    return;
  }

  const saved = readJson(KEYS.config);
  if (saved && saved.token) {
    state.config = { ...DEFAULT_CONFIG, ...saved };
    setView('boot');
    try {
      await connect(state.config);
      checkTokenAge();
      await route();
    } catch (error) {
      state.client = null;
      setView('setup');
      $('setup-token').value = saved.token;
      setConnected(false, '连接失败');
      showError('setup-error', `${errorText(error, '连接失败')}。请检查令牌是否过期、仓库权限是否包含 Contents。`);
    }
    return;
  }

  state.config = { ...DEFAULT_CONFIG };
  setView('setup');
  setConnected(false, '未连接');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
