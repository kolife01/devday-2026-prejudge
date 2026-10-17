import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Adapted from schroneko/automated-hachathon-judge (MIT).
// Preserve its priority/tie order, pre-text top-24 selection and UTF-16 slicing.
export const LIMITS = { files: 24, fileUnits: 12_000, candidateBytes: 48_000, totalBytes: 120_000 };
const TEXT_EXT = /\.(md|txt|ts|tsx|js|jsx|json|css|scss|html|toml|yaml|yml|svg)$/i;
const SECRET_PATH = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\.json)?|auth\.json|id_rsa|id_ed25519)$|\.(?:pem|p12|pfx|key)$/i;
const BINARY_EXT = /\.(?:png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|mp4|mov|mp3|wav|woff2?|ttf|otf|wasm|bin|exe|dylib|so)$/i;

// Local/Git blob APIs have no HTTP MIME. Approximate raw GitHub's text response.
export function inferContentType(path, text) {
  return BINARY_EXT.test(path) || text.includes('\0') ? 'application/octet-stream' : 'text/plain';
}

export function normalizeRepo(input) {
  const url = new URL(input.includes('://') ? input : `https://github.com/${input}`);
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) throw new Error('GitHubのリポジトリURL（https://github.com/owner/repo）を指定してください。');
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length !== 2 || parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || /^\.+$/.test(p))) throw new Error('owner/repo 形式で指定してください。');
  const [owner, raw] = parts;
  const repo = raw.replace(/\.git$/i, '');
  if (!repo || /^\.+$/.test(repo)) throw new Error('リポジトリ名が不正です。');
  return { name: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

export function pathPriority(path) {
  const p = path.toLowerCase();
  let score = 0;
  if (p === 'readme.md' || p.endsWith('/readme.md')) score += 100;
  if (p.endsWith('package.json')) score += 90;
  if (p.includes('wrangler')) score += 80;
  if (p.includes('vite.config')) score += 75;
  if (/\.(ts|tsx|js|jsx)$/.test(p)) score += 60;
  if (/\.(html|css|scss)$/.test(p)) score += 55;
  if (p.includes('src/')) score += 45;
  if (p.includes('app/')) score += 40;
  if (p.includes('pages/')) score += 35;
  if (p.includes('components/')) score += 30;
  if (p.includes('public/')) score += 20;
  if (/\.(png|jpg|jpeg|gif|svg)$/.test(p)) score -= 30;
  if (p.includes('node_modules/')) score -= 1000;
  return score;
}

export function selectFiles(entries) {
  return entries.filter(e => e.type === 'blob' && (e.size ?? 0) <= LIMITS.candidateBytes)
    .sort((a, b) => pathPriority(b.path) - pathPriority(a.path)).slice(0, LIMITS.files);
}

export function probablyText(contentType, path) {
  const t = contentType.toLowerCase();
  return t.startsWith('text/') || /json|javascript|xml/.test(t) || TEXT_EXT.test(path);
}

export async function collectEvidence(entries, read) {
  const selected = selectFiles(entries);
  const selectedPaths = new Set(selected.map(e => e.path));
  const files = [];
  const omitted = entries.filter(e => e.type !== 'blob' || !selectedPaths.has(e.path)).map(e => ({
    path: e.path, reason: e.type !== 'blob' ? 'submodule_or_non_blob' : e.size > LIMITS.candidateBytes ? 'over_48000_bytes' : 'outside_top_24'
  }));
  let total = 0;
  for (const entry of selected) {
    if (total >= LIMITS.totalBytes) { omitted.push({ path: entry.path, reason: 'total_budget' }); continue; }
    // Deliberate difference from upstream: refuse credentials, symlinks and binary blobs.
    if (SECRET_PATH.test(entry.path) || entry.mode === '120000') {
      omitted.push({ path: entry.path, reason: 'sensitive_path_or_symlink' }); continue;
    }
    const response = await read(entry);
    if (!response) { omitted.push({ path: entry.path, reason: 'fetch_failed' }); continue; }
    if (!probablyText(response.contentType ?? '', entry.path) || response.text.includes('\0')) {
      omitted.push({ path: entry.path, reason: 'not_text' }); continue;
    }
    const content = response.text.slice(0, LIMITS.fileUnits);
    const size = Buffer.byteLength(content);
    if (!size) { omitted.push({ path: entry.path, reason: 'empty' }); continue; }
    total += size;
    files.push({ path: entry.path, size, originalSize: entry.size, content, truncated: response.text.length > content.length });
  }
  return { files, omitted, totalBytes: total, selectedPaths: [...selectedPaths] };
}

function ghJson(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    throw new Error(`GitHubを取得できません: ${endpoint}。gh auth status と公開状態を確認してください。${e.stderr?.toString().slice(-500) ?? ''}`);
  }
}

export async function collectGithub(input, { allowPrivate = false } = {}) {
  const repo = normalizeRepo(input);
  const base = `repos/${repo.name}`;
  const meta = ghJson(base);
  if (meta.private && !allowPrivate) throw new Error('対象はPrivateです。事前検証として読む場合は --allow-private を付けてください。公開状態は変更しません。');
  if (!meta.default_branch) throw new Error('デフォルトブランチがありません。');
  const commit = ghJson(`${base}/commits/${encodeURIComponent(meta.default_branch)}`);
  const tree = ghJson(`${base}/git/trees/${commit.sha}?recursive=1`);
  if (tree.truncated) throw new Error('GitHubのtreeが省略されています。完全なファイル一覧がないため採点を停止しました。');
  const entries = tree.tree.filter(e => e.type !== 'tree');
  const evidence = await collectEvidence(entries, async entry => {
    if (meta.private) {
      const blob = ghJson(`${base}/git/blobs/${entry.sha}`);
      if (blob.encoding !== 'base64') throw new Error('GitHub blob encoding is unsupported');
      const text = Buffer.from(blob.content, 'base64').toString('utf8');
      return { text, contentType: inferContentType(entry.path, text) };
    }
    const path = entry.path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`https://raw.githubusercontent.com/${repo.name}/${commit.sha}/${path}`, { signal: AbortSignal.timeout(25_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub raw fetch: HTTP ${response.status} (${entry.path})`);
    return { text: await response.text(), contentType: response.headers.get('content-type') ?? '' };
  });
  return finishSnapshot({ repo: repo.name, url: repo.url, pinnedSha: commit.sha, defaultBranch: meta.default_branch,
    source: 'github', visibility: meta.private ? 'private' : 'public', dirty: null, totalEntries: entries.length, ...evidence });
}

export async function collectLocal(directory) {
  const cwd = resolve(directory);
  const git = args => execFileSync('git', ['-C', cwd, ...args], { maxBuffer: 24 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const pinnedSha = git(['rev-parse', '--verify', 'HEAD']).toString().trim();
  const entries = git(['ls-tree', '-r', '-z', '--long', pinnedSha]).toString().split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, type, sha, size] = line.slice(0, tab).trim().split(/\s+/);
    return { mode, type, sha, size: Number(size) || 0, path: line.slice(tab + 1) };
  });
  const evidence = await collectEvidence(entries, async entry => {
    const text = git(['cat-file', 'blob', entry.sha]).toString('utf8');
    return { text, contentType: inferContentType(entry.path, text) };
  });
  return finishSnapshot({ repo: cwd.split('/').at(-1), url: null, pinnedSha,
    defaultBranch: git(['branch', '--show-current']).toString().trim() || '(detached)',
    source: 'local-head', visibility: 'unknown', dirty: Boolean(git(['status', '--porcelain']).length),
    totalEntries: entries.length, ...evidence });
}

export function finishSnapshot(input) {
  const contentHash = createHash('sha256').update(JSON.stringify(input.files.map(f => [f.path, f.content]))).digest('hex');
  return { formatVersion: 1, capturedAt: new Date().toISOString(), ...input, contentHash, limits: LIMITS,
    collector: 'upstream-priority-v1-with-secret-and-symlink-exclusions' };
}

export function validateSnapshot(s) {
  if (!s || s.formatVersion !== 1 || !/^[a-f0-9]{40}$/.test(s.pinnedSha ?? '') ||
      !Array.isArray(s.files) || s.files.length > LIMITS.files ||
      !Array.isArray(s.omitted) || !Array.isArray(s.selectedPaths) ||
      typeof s.repo !== 'string' || !['github', 'local-head'].includes(s.source) ||
      !['public', 'private', 'unknown'].includes(s.visibility)) throw new Error('Invalid snapshot metadata');
  const paths = new Set();
  for (const f of s.files) {
    if (typeof f.path !== 'string' || f.path.startsWith('/') || f.path.split('/').includes('..') ||
        paths.has(f.path) || typeof f.content !== 'string' || f.content.length > LIMITS.fileUnits ||
        f.size !== Buffer.byteLength(f.content)) throw new Error('Invalid snapshot file');
    paths.add(f.path);
  }
  if (s.totalBytes !== s.files.reduce((n, f) => n + f.size, 0) || s.totalBytes > 160_000 ||
      finishSnapshot(s).contentHash !== s.contentHash) throw new Error('Snapshot hash/size mismatch');
  return s;
}
