import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collectFullEvidence, collectPublishedLocal, prepareFullSource, validateFullEvidence } from '../src/published-evidence.mjs';
import { isEvidencePath } from '../src/published/filters.mjs';
import { isReviewedAsset } from '../src/published/reviewed-assets.mjs';
import { fullEvidence } from './helpers/published-fixtures.mjs';

const metadata = { repo: 'fixture/app', pinnedSha: 'a'.repeat(40) };
const entry = path => ({ path, mode: '100644', type: 'blob' });

test('latest filters exclude standard tests/assets before reads and keep inline code, unknown text and product examples', async () => {
  const excluded = ['tests/a.ts', 'src/a.test.ts', 'src/test_x.py', 'FooTest.java', 'e2e/a.ts', 'node_modules/a.js', '.env', '.env.sample',
    'package-lock.json', 'large.SVG', 'photo.HEIC', 'x.gltf', 'app.js.map'];
  const included = ['src/app.js', 'examples/usage.js', 'src/spec-parser.ts', 'api-spec.json', 'world.map', 'shader.wgsl', 'odd.unknown', 'weights.pt'];
  const reads = [];
  const result = await collectFullEvidence([...excluded, ...included].map(entry), e => {
    reads.push(e.path); return Buffer.from('<svg>inline</svg>');
  }, metadata);
  assert.deepEqual(reads, included); assert.equal(result.omitted.length, excluded.length);
  assert(result.files.every(f => f.truncated === false));
  for (const path of ['src/app.ts', 'src/sample.specification.ts', 'testimonials/main.ts']) assert(isEvidencePath(path));
});

test('full collector keeps file 25 and byte 12001, preserving BOM, rather than old top-24 slicing', async () => {
  const paths = Array.from({ length: 25 }, (_, i) => `src/${i}.js`);
  const body = Buffer.from('\ufeff' + '日本語'.repeat(5000));
  const result = await collectFullEvidence(paths.map(entry), () => body, metadata);
  assert.equal(result.files.length, 25); assert.equal(result.files[24].content, body.toString('utf8'));
});

test('capacity overflow or missing blobs fails instead of scoring partial evidence', async () => {
  let reads = 0;
  await assert.rejects(collectFullEvidence(Array.from({ length: 2001 }, (_, i) => entry(`src/${i}`)), () => { reads++; }, metadata), /capacity/);
  assert.equal(reads, 0);
  await assert.rejects(collectFullEvidence([entry('src/a.js')], () => null, metadata), /partial/);
  await assert.rejects(collectFullEvidence([entry('src/a.js')], () => Buffer.alloc(3 * 1024 * 1024 + 1, 65), metadata), /file exceeds/);
  await assert.rejects(collectFullEvidence([entry('src/a.js'), entry('src/b.js')], () => Buffer.alloc(2 * 1024 * 1024, 65), metadata), /total byte/);
});

test('invalid UTF-8/NUL is omitted, and a claimed immutable Git blob hash must match', async () => {
  const data = { 'src/a.js': Buffer.from('ok'), 'odd.data': Buffer.from([0xc3, 0x28]), 'null-byte.data': Buffer.from([65, 0]) };
  const result = await collectFullEvidence(Object.keys(data).map(entry), e => data[e.path], metadata);
  assert.equal(result.files.length, 1); assert.equal(result.omitted.length, 2);
  await assert.rejects(collectFullEvidence([{ ...entry('src/a.js'), sha: 'b'.repeat(40) }], () => Buffer.from('ok'), metadata), /integrity/);
  const bytes = Buffer.from('ok'), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  let reads = 0;
  const shared = await collectFullEvidence(['src/a.js', 'src/b.js'].map(path => ({ ...entry(path), sha })), () => { reads++; return bytes; }, metadata);
  assert.equal(reads, 1); assert.equal(shared.files.length, 2);
});

test('reviewed assets are excluded only for exact repository, SHA and path', () => {
  const repo = 'eightman999/DevDay-Community-Hackathon', sha = '1a458327b7208bdaaabb2cd4d52ca4da7821e43d', path = 'presentation/index.html';
  assert.equal(isReviewedAsset(repo, sha, path), true);
  assert.equal(isReviewedAsset(repo, 'a'.repeat(40), path), false);
  assert.equal(isReviewedAsset('other/repo', sha, path), false);
  assert.equal(isReviewedAsset(repo, sha, 'src/index.html'), false);
});

test('full-source validation rejects partial reuse, altered metadata, excluded files and serialized overflow', () => {
  assert.throws(() => validateFullEvidence({ formatVersion: 1 }), /collect old/);
  const evidence = fullEvidence(); evidence.snapshot.files[0].content += 'changed';
  assert.throws(() => validateFullEvidence(evidence), /size mismatch/);
  const changed = fullEvidence(); changed.snapshot.summary = 'different';
  assert.throws(() => validateFullEvidence(changed), /hash/);
  const partial = fullEvidence(); partial.snapshot.files[0].truncated = true;
  assert.throws(() => validateFullEvidence(partial), /truncation/);
  const excluded = fullEvidence(); excluded.snapshot.files[0].path = 'tests/app.js';
  assert.throws(() => prepareFullSource(excluded.snapshot), /excluded/);
  const large = fullEvidence().snapshot, content = '\\'.repeat(3 * 1024 * 1024);
  large.files = [{ path: 'data.txt', content, size: content.length, truncated: false }];
  assert.throws(() => prepareFullSource(large), /serialized/);
});

test('local full-source snapshot uses immutable HEAD, excludes test/symlink and ignores candidate exclusion config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'published-evidence-'));
  const git = args => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' });
  try {
    await mkdir(join(directory, 'src')); await mkdir(join(directory, 'tests'));
    await writeFile(join(directory, 'src/app.js'), 'export const value = 1;');
    await writeFile(join(directory, 'tests/app.test.js'), 'throw new Error("never execute");');
    await writeFile(join(directory, '.gitignore'), 'src/app.js\n');
    await symlink('src/app.js', join(directory, 'link.js'));
    git(['init', '-b', 'main']); git(['add', '-f', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic source']);
    await writeFile(join(directory, 'src/app.js'), 'DIRTY'); await writeFile(join(directory, 'untracked.js'), 'UNTRACKED');
    const evidence = await collectPublishedLocal(directory);
    assert.equal(evidence.dirty, true);
    assert.equal(evidence.snapshot.files.find(f => f.path === 'src/app.js').content, 'export const value = 1;');
    assert(!evidence.snapshot.files.some(f => ['link.js', 'tests/app.test.js', 'untracked.js'].includes(f.path)));
    assert.equal(evidence.visibility, 'unknown');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
