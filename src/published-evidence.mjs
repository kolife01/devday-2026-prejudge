import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { normalizeRepo } from './evidence.mjs';
import { isEvidencePath } from './published/filters.mjs';
import { isReviewedAsset } from './published/reviewed-assets.mjs';
import { MAX_EVIDENCE_FILES, MAX_EVIDENCE_FILE_BYTES, MAX_EVIDENCE_TOTAL_BYTES, MAX_SNAPSHOT_SERIALIZED_BYTES } from './published/constants.mjs';

export const PUBLISHED_COMMIT = '23016a7dcfe71cf67a3d9405a84ff3b9021e203c';
export const COLLECTOR = 'published-23016a7-full-source-v1';
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const WIRE_LIMIT = 16 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
export const sourceLimits = { files: MAX_EVIDENCE_FILES, fileBytes: MAX_EVIDENCE_FILE_BYTES,
  totalBytes: MAX_EVIDENCE_TOTAL_BYTES, serializedBytes: MAX_SNAPSHOT_SERIALIZED_BYTES };

export function assertSourcePath(path) {
  if (typeof path !== 'string' || !path || Buffer.byteLength(path) > 1024 ||
      path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) ||
      /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(path) || decoder.decode(Buffer.from(path)) !== path) {
    throw new Error('Invalid, unsafe or non-UTF-8 source path');
  }
}

export function prepareFullSource(snapshot) {
  const repo = snapshot?.repo;
  if (!repo || typeof repo.owner !== 'string' || typeof repo.repo !== 'string' ||
      repo.normalized !== `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}` ||
      repo.canonicalUrl !== normalizeRepo(`${repo.owner}/${repo.repo}`).url ||
      snapshot.assessment !== 'scored' || snapshot.fullSource !== true ||
      !/^[a-f0-9]{40}$/.test(snapshot.pinnedSha ?? '') || typeof snapshot.defaultBranch !== 'string' || !snapshot.defaultBranch.trim() ||
      typeof snapshot.summary !== 'string' || !Array.isArray(snapshot.files) || !snapshot.files.length || snapshot.files.length > MAX_EVIDENCE_FILES) {
    throw new Error('Invalid full-source snapshot; partial/legacy snapshots must be collected again');
  }
  const paths = new Set();
  let sourceBytes = 0;
  const files = snapshot.files.map(file => {
    assertSourcePath(file?.path);
    if (paths.has(file.path) || !isEvidencePath(file.path) || isReviewedAsset(repo.normalized, snapshot.pinnedSha, file.path)) throw new Error('Duplicate or excluded source path');
    paths.add(file.path);
    if (typeof file.content !== 'string' || file.truncated !== false || file.content.includes('\0') ||
        decoder.decode(Buffer.from(file.content)) !== file.content) throw new Error('Source must be complete UTF-8; truncation is not allowed');
    const size = Buffer.byteLength(file.content);
    if (file.size !== size || size > MAX_EVIDENCE_FILE_BYTES) throw new Error('Source file exceeds byte capacity or size mismatch');
    sourceBytes += size;
    if (sourceBytes > MAX_EVIDENCE_TOTAL_BYTES) throw new Error('Source exceeds total byte capacity');
    return { path: file.path, size, content: file.content, truncated: false };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const data = { repo: { owner: repo.owner, repo: repo.repo, normalized: repo.normalized, canonicalUrl: repo.canonicalUrl },
    assessment: 'scored', pinnedSha: snapshot.pinnedSha, defaultBranch: snapshot.defaultBranch, summary: snapshot.summary, files, fullSource: true };
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_SERIALIZED_BYTES) throw new Error('Source exceeds serialized byte capacity');
  return { data, serialized, metadata: { fullSource: true, sourceFiles: files.length, sourceBytes, sourceHash: digest(serialized) } };
}

export function validateFullEvidence(value) {
  if (value?.formatVersion !== 2 || value.collector !== COLLECTOR || value.policyCommit !== PUBLISHED_COMMIT ||
      !['github', 'local-head'].includes(value.source) || !['public', 'private', 'unknown'].includes(value.visibility) ||
      !Array.isArray(value.omitted) || !Number.isSafeInteger(value.candidateCount) || value.candidateCount > MAX_EVIDENCE_FILES ||
      !Number.isSafeInteger(value.totalEntries) || value.totalEntries < value.candidateCount) {
    throw new Error('published-v4 requires a new full-source evidence.json (formatVersion 2); collect old/partial evidence again');
  }
  const prepared = prepareFullSource(value.snapshot);
  if (value.candidateCount < prepared.metadata.sourceFiles || Object.entries(prepared.metadata).some(([k, v]) => value[k] !== v)) throw new Error('Full-source hash/count/size mismatch');
  for (const item of value.omitted) {
    assertSourcePath(item?.path);
    if (typeof item.reason !== 'string') throw new Error('Invalid omission record');
  }
  return value;
}

// Filters run before blob retrieval and before the candidate-file capacity check.
export async function collectFullEvidence(entries, read, { repo, pinnedSha }) {
  if (!Array.isArray(entries) || entries.length > 50_000) throw new Error('Git tree exceeds entry capacity');
  const candidates = [], omitted = [], paths = new Set();
  let pathBytes = 0;
  for (const entry of entries) {
    assertSourcePath(entry.path);
    if (paths.has(entry.path)) throw new Error('Duplicate Git tree path');
    paths.add(entry.path);
    pathBytes += Buffer.byteLength(entry.path);
    if (pathBytes > 8 * 1024 * 1024 || entry.path.split('/').length > 65) throw new Error('Git tree exceeds metadata/depth capacity');
    if (entry.type === 'tree') continue;
    if (entry.mode === '120000' || entry.mode === '160000') { omitted.push({ path: entry.path, reason: 'symlink_or_submodule' }); continue; }
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new Error('Unsupported Git entry mode');
    if (!isEvidencePath(entry.path) || isReviewedAsset(repo, pinnedSha, entry.path)) {
      omitted.push({ path: entry.path, reason: 'published_path_filter_or_reviewed_asset' }); continue;
    }
    candidates.push(entry);
  }
  if (candidates.length > MAX_EVIDENCE_FILES) throw new Error('Source exceeds candidate file capacity (2000); nothing was scored');
  const files = [];
  let totalBytes = 0;
  const blobs = new Map();
  for (const entry of candidates) {
    // Immutable Git objects may be shared by several paths. Charge each path its full size.
    let bytes = blobs.get(entry.sha);
    if (!bytes) {
      bytes = await read(entry);
      if (!(bytes instanceof Uint8Array)) throw new Error('Missing source blob; partial scoring is forbidden');
      bytes = Buffer.from(bytes);
      if (typeof entry.sha === 'string' && /^[a-f0-9]{40}$/.test(entry.sha)) {
        const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (oid !== entry.sha) throw new Error('Git blob integrity mismatch');
        blobs.set(entry.sha, bytes);
      }
    }
    let content;
    try { if (bytes.includes(0)) throw new Error(); content = decoder.decode(bytes); }
    catch { omitted.push({ path: entry.path, reason: 'binary_or_invalid_utf8' }); continue; }
    if (bytes.length > MAX_EVIDENCE_FILE_BYTES) throw new Error('Source file exceeds byte capacity');
    totalBytes += bytes.length;
    if (totalBytes > MAX_EVIDENCE_TOTAL_BYTES) throw new Error('Source exceeds total byte capacity');
    files.push({ path: entry.path, size: bytes.length, content, truncated: false });
  }
  if (!files.length) throw new Error('No readable source evidence; no score was produced');
  return { files, omitted, candidateCount: candidates.length, totalEntries: entries.length };
}

function identity(name) {
  const { name: normalizedName, url } = normalizeRepo(name);
  const [owner, repo] = normalizedName.split('/');
  return { owner, repo, normalized: normalizedName.toLowerCase(), canonicalUrl: url };
}

function envelope(meta, evidence) {
  const { repo, pinnedSha, defaultBranch, ...audit } = meta;
  const prepared = prepareFullSource({ repo, pinnedSha, defaultBranch, assessment: 'scored', fullSource: true,
    summary: '固定コミットのGit追跡ソース全文を評価。', files: evidence.files });
  return validateFullEvidence({ formatVersion: 2, collector: COLLECTOR, policyCommit: PUBLISHED_COMMIT,
    capturedAt: new Date().toISOString(), ...audit, omitted: evidence.omitted, candidateCount: evidence.candidateCount,
    totalEntries: evidence.totalEntries, snapshot: prepared.data, ...prepared.metadata });
}

function gh(endpoint) {
  try { return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', timeout: 45_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw new Error('GitHub API取得に失敗しました。ghの認証・レート制限・リポジトリを確認してください。'); }
}

async function rawBlob(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`GitHub blob fetch failed (HTTP ${response.status}); no partial scoring`); }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > WIRE_LIMIT) throw new Error('GitHub blob exceeds retrieval capacity');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function collectPublishedGithub(input, { allowPrivate = false } = {}) {
  const repo = identity(normalizeRepo(input).name), base = `repos/${repo.owner}/${repo.repo}`;
  const meta = gh(base);
  if (meta.private && !allowPrivate) throw new Error('Privateには --allow-private が必要です。');
  if (typeof meta.private !== 'boolean' || !meta.default_branch) throw new Error('Invalid repository metadata/default branch');
  const commit = gh(`${base}/commits/${encodeURIComponent(meta.default_branch)}`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) throw new Error('Invalid pinned commit');
  const tree = gh(`${base}/git/trees/${commit.sha}?recursive=1`);
  if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('Incomplete Git tree; no partial scoring');
  const evidence = await collectFullEvidence(tree.tree, async entry => {
    if (meta.private) {
      const blob = gh(`${base}/git/blobs/${entry.sha}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('Unsupported GitHub blob');
      return Buffer.from(blob.content, 'base64');
    }
    return rawBlob(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${commit.sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}`);
  }, { repo: repo.normalized, pinnedSha: commit.sha });
  return envelope({ repo, pinnedSha: commit.sha, defaultBranch: meta.default_branch, source: 'github', visibility: meta.private ? 'private' : 'public', dirty: null }, evidence);
}

export async function collectPublishedLocal(directory) {
  const cwd = resolve(directory);
  const git = args => {
    try { return execFileSync('git', ['-C', cwd, ...args], { maxBuffer: WIRE_LIMIT, timeout: 45_000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { throw new Error('Local Git source acquisition failed'); }
  };
  const pinnedSha = git(['rev-parse', '--verify', 'HEAD']).toString().trim();
  let repo;
  try { repo = identity(normalizeRepo(git(['remote', 'get-url', 'origin']).toString().trim().replace(/^git@github\.com:/, 'https://github.com/')).name); }
  catch { repo = identity(`local/${basename(cwd).replace(/[^A-Za-z0-9_-]/g, '-') || 'repository'}`); }
  const entries = decoder.decode(git(['ls-tree', '-r', '-z', '--long', pinnedSha])).split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, type, sha, size] = line.slice(0, tab).trim().split(/\s+/);
    return { mode, type, sha, size: Number(size) || 0, path: line.slice(tab + 1) };
  });
  const evidence = await collectFullEvidence(entries, entry => git(['cat-file', 'blob', entry.sha]), { repo: repo.normalized, pinnedSha });
  return envelope({ repo, pinnedSha, defaultBranch: git(['branch', '--show-current']).toString().trim() || '(detached)',
    source: 'local-head', visibility: 'unknown', dirty: Boolean(git(['status', '--porcelain']).length) }, evidence);
}
