/**
 * GitHub REST API 的最小封装，只做写作台需要的几件事：
 * 读目录、读文件、写文件、删文件、上传图片。
 *
 * 刻意不依赖 octokit：请求量很小，原生 fetch 足够；
 * 也方便测试时注入 fetchImpl 做端到端模拟。
 */

export class GitHubError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = options.status ?? 0;
    this.data = options.data;
    this.rateLimit = options.rateLimit;
  }
}

const API_VERSION = '2022-11-28';

/** 文本 → base64（浏览器与 Node 都可用） */
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 → 文本（GitHub 的 content 字段带换行，先清掉） */
export function decodeBase64(base64) {
  const clean = String(base64 ?? '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 逐段编码路径，文件名里带中文/空格也不会坏 */
export function encodePath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function errorMessage(status, data) {
  const apiMessage = typeof data?.message === 'string' ? data.message : '';
  if (status === 401) return '访问令牌无效或已过期，请到 GitHub 重新生成';
  if (status === 403) {
    if (/rate limit/i.test(apiMessage)) return 'GitHub API 请求太频繁，请等几分钟再试';
    return '这个令牌没有写入权限：需要 Contents 的 Read and write';
  }
  if (status === 404) return '找不到仓库、分支或文件，也可能是令牌没有该仓库的访问权限';
  if (status === 409) return '文件在别处被修改过（版本冲突），需要先同步';
  if (status === 422 && /fast forward|stale/i.test(apiMessage)) {
    return '分支在你提交前又被更新了，刷新后再试一次';
  }
  if (status === 422) return `提交被 GitHub 拒绝：${apiMessage || '内容或参数不合法'}`;
  if (status >= 500) return 'GitHub 服务暂时不可用，请稍后重试';
  return `请求失败（HTTP ${status}）${apiMessage ? `：${apiMessage}` : ''}`;
}

/**
 * @param {{token:string, owner:string, repo:string, branch?:string, baseUrl?:string, fetchImpl?:Function}} options
 */
export function createGitHubClient(options = {}) {
  const {
    token,
    owner,
    repo,
    branch = 'main',
    baseUrl = 'https://api.github.com',
    fetchImpl = globalThis.fetch,
  } = options;

  if (!token) throw new Error('缺少访问令牌');
  if (!owner || !repo) throw new Error('缺少仓库信息（owner / repo）');

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function request(path, { method = 'GET', body } = {}) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new GitHubError('网络请求失败：检查手机网络或代理设置', { status: 0, data: error });
    }

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new GitHubError(errorMessage(response.status, data), {
        status: response.status,
        data,
        rateLimit: response.headers?.get?.('x-ratelimit-remaining') ?? null,
      });
    }
    return data;
  }

  // 注意：读 ref 用 git/ref/（单数），写 ref 用 git/refs/（复数），这是 GitHub 的历史包袱
  const refReadPath = `${repoPath}/git/ref/heads/${encodePath(branch)}`;
  const refWritePath = `${repoPath}/git/refs/heads/${encodePath(branch)}`;

  async function getRef() {
    const data = await request(refReadPath);
    return { sha: data?.object?.sha ?? '' };
  }

  async function getCommit(sha) {
    const data = await request(`${repoPath}/git/commits/${encodeURIComponent(sha)}`);
    return { sha: data.sha, message: data.message ?? '', treeSha: data?.tree?.sha ?? '' };
  }

  async function createCommit({ message, tree, parents }) {
    const data = await request(`${repoPath}/git/commits`, {
      method: 'POST',
      body: { message, tree, parents },
    });
    return { sha: data.sha, commitUrl: `https://github.com/${owner}/${repo}/commit/${data.sha}` };
  }

  /**
   * 一个 commit 里完成多个文件的新增 / 修改 / 删除。
   * 重命名 = 新路径写入 + 旧路径删除，同一个 commit 落地，
   * 不会出现「写成功了但旧文件没删掉、站点上出现两篇同名文章」的中间态。
   *
   * changes: [{ path, text }] | [{ path, base64 }] | [{ path, delete: true }]
   */
  async function commitFiles(changes, { message } = {}) {
    const list = (Array.isArray(changes) ? changes : []).filter((item) => item && item.path && typeof item.path === 'string');
    if (list.length === 0) throw new GitHubError('没有要提交的改动', { status: 400 });

    const { sha: parentSha } = await getRef();
    if (!parentSha) throw new GitHubError('读不到分支的最新提交，稍后重试', { status: 404 });
    const parent = await getCommit(parentSha);

    const entries = [];
    for (const change of list) {
      if (change.delete) {
        entries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
        continue;
      }
      if (change.base64 !== undefined) {
        const blob = await request(`${repoPath}/git/blobs`, {
          method: 'POST',
          body: { content: String(change.base64).replace(/^data:[^;]+;base64,/, ''), encoding: 'base64' },
        });
        entries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
        continue;
      }
      entries.push({ path: change.path, mode: '100644', type: 'blob', content: String(change.text ?? '') });
    }

    const tree = await request(`${repoPath}/git/trees`, {
      method: 'POST',
      body: { base_tree: parent.treeSha, tree: entries },
    });
    const commit = await createCommit({ message: message || 'post: 更新文件', tree: tree.sha, parents: [parentSha] });
    await request(refWritePath, { method: 'PATCH', body: { sha: commit.sha, force: false } });

    return { commitSha: commit.sha, commitUrl: commit.commitUrl, files: list.length };
  }

  /** 递归列目录下的文件（图片库用）；路径里带时间戳，倒序 ≈ 新上传的在前 */
  async function listTree(dir) {
    const data = await request(`${repoPath}/git/trees/${encodePath(branch)}?recursive=1`);
    const tree = Array.isArray(data && data.tree) ? data.tree : [];
    const prefix = `${String(dir ?? '').replace(/\/+$/, '')}/`;
    return tree
      .filter((item) => item && item.type === 'blob' && String(item.path).startsWith(prefix))
      .map((item) => ({
        path: item.path,
        name: String(item.path).slice(prefix.length),
        size: item.size ?? 0,
        sha: item.sha,
      }))
      .sort((a, b) => String(b.path).localeCompare(String(a.path)));
  }

  return {
    owner,
    repo,
    branch,
    baseUrl,
    isDemo: false,

    /** 当前令牌对应的人 */
    async getUser() {
      const user = await request('/user');
      return { login: user.login, name: user.name ?? user.login, avatarUrl: user.avatar_url };
    },

    /** 仓库基本信息（默认分支、是否私有） */
    async getRepo() {
      const data = await request(repoPath);
      return {
        fullName: data.full_name,
        defaultBranch: data.default_branch,
        private: Boolean(data.private),
        htmlUrl: data.html_url,
      };
    },

    /** 列文章目录下的 Markdown 文件 */
    async listFiles(dir) {
      const data = await request(`${repoPath}/contents/${encodePath(dir)}?ref=${encodeURIComponent(branch)}`);
      if (!Array.isArray(data)) throw new GitHubError('文章目录不是一个文件夹，请检查路径设置', { status: 404 });
      return data
        .filter((item) => item.type === 'file' && /\.mdx?$/i.test(item.name))
        .map((item) => ({ name: item.name, path: item.path, sha: item.sha, size: item.size }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** 读取一个文件（返回 sha + 文本） */
    async getFile(path) {
      const data = await request(`${repoPath}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
      if (Array.isArray(data)) throw new GitHubError('这是一个目录，不是文件', { status: 400 });
      if (!data.content && data.size > 0) {
        throw new GitHubError('文件超过 1 MB，写作台暂不支持直接编辑', { status: 413 });
      }
      return { path: data.path, sha: data.sha, size: data.size, text: decodeBase64(data.content ?? '') };
    },

    /** 新建或更新文本文件；更新时必须带 sha */
    async putFile(path, text, { message, sha } = {}) {
      const body = {
        message: message || 'post: 更新文章',
        content: encodeBase64(text),
        branch,
      };
      if (sha) body.sha = sha;
      const data = await request(`${repoPath}/contents/${encodePath(path)}`, { method: 'PUT', body });
      return {
        sha: data?.content?.sha ?? null,
        commitSha: data?.commit?.sha ?? null,
        commitUrl: data?.commit?.html_url ?? null,
      };
    },

    /** 删除文件 */
    async deleteFile(path, { message, sha } = {}) {
      if (!sha) throw new GitHubError('缺少文件版本号（sha），无法安全删除', { status: 400 });
      const data = await request(`${repoPath}/contents/${encodePath(path)}`, {
        method: 'DELETE',
        body: { message: message || 'post: 删除文章', sha, branch },
      });
      return { commitSha: data?.commit?.sha ?? null, commitUrl: data?.commit?.html_url ?? null };
    },

    /** 上传二进制文件（图片）；base64 不带 data: 前缀 */
    async putBinary(path, base64, { message, sha } = {}) {
      const body = {
        message: message || 'assets: 上传图片',
        content: String(base64).replace(/^data:[^;]+;base64,/, ''),
        branch,
      };
      if (sha) body.sha = sha;
      const data = await request(`${repoPath}/contents/${encodePath(path)}`, { method: 'PUT', body });
      return {
        sha: data?.content?.sha ?? null,
        commitSha: data?.commit?.sha ?? null,
        commitUrl: data?.commit?.html_url ?? null,
      };
    },

    /** 分支最新提交 */
    getRef,
    /** 提交详情（含 root tree） */
    getCommit,
    /** 多文件原子提交：新增 / 修改 / 删除合在一个 commit 里 */
    commitFiles,
    /** 递归列目录（图片库） */
    listTree,
  };
}
