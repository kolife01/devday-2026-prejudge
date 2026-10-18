import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rules, rubric, jsonHash } from '../src/rubric.mjs';
import { snapshot } from './helpers/fixtures.mjs';
const run = promisify(execFile);
const cli = resolve('src/cli.mjs');
const preload = resolve('tests/helpers/mock-fetch.mjs');
const key = 'offline-test-key-never-valid';

async function fixture(fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'prejudge-cli-'));
  const s = snapshot(options);
  const input = join(dir, 'input.json');
  const out = join(dir, 'output');
  const called = join(dir, 'fetch-called');
  await writeFile(input, JSON.stringify(s));
  const env = { ...process.env, PREJUDGE_TEST_EXPECT_KEY: key, PREJUDGE_TEST_CALLED: called };
  delete env.OPENAI_API_KEY;
  delete env.NODE_OPTIONS;
  const execute = (args = [], extraEnv = {}) => run(process.execPath,
    ['--import', preload, cli, ...args, '--profile', 'legacy-44', '--snapshot', input, '--out', out], { cwd: dir, env: { ...env, ...extraEnv } });
  try { await fn({ dir, s, out, called, execute }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

for (const args of [['snapshot'], ['judge', '--dry-run']]) test(`${args.join(' ')} needs no key, saves exact input, never calls API, and refuses overwrite`, async () => {
  await fixture(async ({ out, s, called, execute }) => {
    const result = await execute(args);
    assert(result.stdout.includes('API採点は未実行'));
    const request = JSON.parse(await readFile(join(out, 'request.json'), 'utf8'));
    assert.equal(JSON.parse(request.input).contentHash, s.contentHash);
    assert.equal(request.questions.filter(q => q.type === 'score').length, 4);
    assert.equal(JSON.parse(await readFile(join(out, 'event-rules.json'), 'utf8')).asOf, rules.asOf);
    assert.equal(JSON.parse(await readFile(join(out, 'rubric.json'), 'utf8')).id, rubric.id);
    await assert.rejects(readFile(called), /ENOENT/);
    await assert.rejects(readFile(join(out, 'result.json')), /ENOENT/);
    await assert.rejects(execute(args), /EEXIST/);
  });
});

test('absent key saves material and failure, does not call API or fabricate zero score', async () => {
  await fixture(async ({ out, called, execute }) => {
    await assert.rejects(execute(['judge']), /OPENAI_API_KEYが未設定/);
    assert.equal(JSON.parse(await readFile(join(out, 'failure.json'), 'utf8')).scored, false);
    await readFile(join(out, 'request.json'));
    await assert.rejects(readFile(called), /ENOENT/);
    await assert.rejects(readFile(join(out, 'result.json')), /ENOENT/);
    await assert.rejects(readFile(join(out, 'report.md')), /ENOENT/);
  });
});

test('judge auto-loads .env and creates v3 scores with distributions and reproducible hashes', async () => {
  await fixture(async ({ dir, out, called, execute }) => {
    await writeFile(join(dir, '.env'), `# Local test only\nOPENAI_API_KEY=${key}\n`);
    const response = await execute(['judge']);
    assert(response.stdout.includes('27.10 / 40'));
    assert.equal(await readFile(called, 'utf8'), 'called');
    const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8'));
    const request = JSON.parse(await readFile(join(out, 'request.json'), 'utf8'));
    const savedRubric = JSON.parse(await readFile(join(out, 'rubric.json'), 'utf8'));
    assert.equal(result.version, 3); assert.equal(result.official, false);
    assert.equal(result.criteriaOfficial, true); assert.equal(result.scoringScaleOfficial, false);
    assert.equal(result.rubricId, rubric.id); assert.equal(result.rulesAsOf, rules.asOf);
    assert.equal(result.requestHash, jsonHash(request)); assert.equal(result.rubricHash, jsonHash(savedRubric));
    assert.equal(result.runtime.api, 'decisions'); assert.equal(result.runtime.reportedModel, 'gpt-6-luna');
    assert.equal(result.result.total, 7.4 + 6.2 + 8 + 5.5);
    assert.equal(result.result.criteria[0].probabilities.length, 11);
    assert(!result.snapshot.files[0].content);
    assert.equal((await stat(out)).mode & 0o777, 0o700);
    for (const name of await readdir(out)) {
      assert(!(await readFile(join(out, name), 'utf8')).includes(key), name);
      assert.equal((await stat(join(out, name))).mode & 0o777, 0o600);
    }
    assert(!response.stdout.includes(key)); assert(!response.stderr.includes(key));
    assert((await readFile(join(out, 'report.md'), 'utf8')).includes('作品固有の講評ではなく'));
  });
});

test('existing OPENAI_API_KEY takes precedence over .env', async () => {
  await fixture(async ({ dir, execute }) => {
    await writeFile(join(dir, '.env'), 'OPENAI_API_KEY=unused-file-key\n');
    await execute(['judge'], { OPENAI_API_KEY: key });
  });
});

for (const mode of ['refusal', 'missing', 'unauthorized']) test(`${mode} does not produce a report or result, and never saves a key`, async () => {
  await fixture(async ({ dir, out, execute }) => {
    await writeFile(join(dir, '.env'), `OPENAI_API_KEY=${key}\n`);
    await assert.rejects(execute(['judge'], { PREJUDGE_TEST_MODE: mode }), error => !error.stderr.includes(key));
    assert.equal(JSON.parse(await readFile(join(out, 'failure.json'), 'utf8')).scored, false);
    await assert.rejects(readFile(join(out, 'result.json')), /ENOENT/);
    await assert.rejects(readFile(join(out, 'report.md')), /ENOENT/);
    for (const name of await readdir(out)) assert(!(await readFile(join(out, name), 'utf8')).includes(key));
  });
});

test('private snapshots require explicit --allow-private, including offline preparation', async () => {
  await fixture(async ({ execute }) => {
    await assert.rejects(execute(['snapshot']), /allow-private/);
    await execute(['snapshot', '--allow-private']);
  }, { visibility: 'private' });
});

test('unsupported model and removed effort option fail before producing a request', async () => {
  await fixture(async ({ out, execute }) => {
    await assert.rejects(execute(['judge', '--model', 'gpt-6.1-sol']), /対応モデル/);
    await assert.rejects(execute(['judge', '--effort', 'medium']), /effort/);
    await assert.rejects(readFile(join(out, 'request.json')), /ENOENT/);
  });
});

test('.env is ignored and .env.sample is trackable with a blank key only', async () => {
  await run('git', ['check-ignore', '--no-index', '-q', '.env']);
  await run('git', ['check-ignore', '--no-index', '-q', '.env.local']);
  await assert.rejects(run('git', ['check-ignore', '--no-index', '-q', '.env.sample']));
  const sample = await readFile('.env.sample', 'utf8');
  assert.match(sample, /^OPENAI_API_KEY=$/m);
  assert.equal(sample.split('\n').filter(line => line && !line.startsWith('#')).length, 1);
});
