import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fullEvidence } from './helpers/published-fixtures.mjs';
const run = promisify(execFile), cli = resolve('src/cli.mjs'), preload = resolve('tests/helpers/published-fetch.mjs');
const key = 'offline-published-test-key';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

async function fixture(fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'published-cli-'));
  const evidence = fullEvidence(options), input = join(dir, 'evidence.json'), out = join(dir, 'run'), called = join(dir, 'calls');
  await writeFile(input, JSON.stringify(evidence));
  const env = { ...process.env, PREJUDGE_TEST_EXPECT_KEY: key, PREJUDGE_TEST_CALLED: called };
  delete env.OPENAI_API_KEY; delete env.NODE_OPTIONS;
  const execute = (args = ['judge'], extra = {}, output = out) => run(process.execPath,
    ['--import', preload, cli, ...args, ...(args[0] === 'explain' ? [] : ['--snapshot', input]), '--out', output], { cwd: dir, env: { ...env, ...extra } });
  const setKey = () => writeFile(join(dir, '.env'), `OPENAI_API_KEY=${key}\n`);
  try { await fn({ dir, out, input, evidence, called, execute, setKey }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

for (const args of [['snapshot'], ['judge', '--dry-run']]) test(`default published ${args.join(' ')} never calls an API or creates fake scores`, async () => {
  await fixture(async ({ out, called, execute }) => {
    const output = await execute(args); assert.match(output.stdout, /API採点は未実行/);
    assert.equal((await readJson(join(out, 'request.json'))).questions.length, 21);
    assert.equal((await readJson(join(out, 'evidence.json'))).formatVersion, 2);
    assert.equal((await readJson(join(out, 'explanation-preflight-request.json'))).reasoning.effort, 'medium');
    await assert.rejects(readFile(called), /ENOENT/); await assert.rejects(readFile(join(out, 'result.json')), /ENOENT/);
    await assert.rejects(execute(args), /EEXIST/);
  });
});

test('default judge loads .env, preflights both stages, saves immutable score plus Japanese explanation', async () => {
  await fixture(async ({ dir, out, called, execute, setKey }) => {
    await setKey(); const output = await execute(); assert.match(output.stdout, /32 \/ 40/);
    assert.deepEqual((await readFile(called, 'utf8')).trim().split('\n'), [
      '/v1/responses/input_tokens', '/v1/responses/input_tokens', '/v1/decisions', '/v1/responses/input_tokens', '/v1/responses'
    ]);
    const final = await readJson(join(out, 'result.json')), fixed = await readJson(join(out, 'decisions-result.json'));
    assert.equal(final.version, 4); assert.equal(final.official, false); assert.equal(final.explanationStatus, 'completed');
    assert.equal(final.result.total, fixed.result.total); assert.equal(final.result.sourceHash, fixed.result.sourceHash);
    assert(final.result.criteria.every(c => c.evidencePaths.length && c.reason.includes('実装')));
    assert.equal(fixed.explanationStatus, 'pending'); assert.equal(fixed.runtime.explanation, undefined);
    assert(!output.stdout.includes(key)); assert(!output.stderr.includes(key));
    assert.equal((await stat(out)).mode & 0o777, 0o700);
    for (const file of await readdir(out)) {
      assert(!(await readFile(join(out, file), 'utf8')).includes(key));
      assert.equal((await stat(join(out, file))).mode & 0o777, 0o600);
    }
    await writeFile(join(dir, '.env'), 'OPENAI_API_KEY=other-file-value\n');
    await execute(['judge', '--scores-only'], { OPENAI_API_KEY: key }, join(dir, 'second'));
  });
});

test('scores-only skips Responses and allows explicit explanation-only retry in a new run', async () => {
  await fixture(async ({ dir, out, called, execute, setKey }) => {
    await setKey(); await execute(['judge', '--scores-only']);
    assert.equal((await readJson(join(out, 'result.json'))).explanationStatus, 'skipped');
    const before = await readFile(join(out, 'decisions-result.json'), 'utf8');
    await writeFile(called, ''); const retry = join(dir, 'retry');
    await execute(['explain', '--from', out], {}, retry);
    assert.deepEqual((await readFile(called, 'utf8')).trim().split('\n'), ['/v1/responses/input_tokens', '/v1/responses']);
    assert.equal((await readJson(join(retry, 'result.json'))).explanationStatus, 'completed');
    assert.equal(await readFile(join(out, 'decisions-result.json'), 'utf8'), before);
  });
});

for (const mode of ['explanation-http', 'explanation-score']) test(`${mode} preserves fixed score with nonzero exit; retry doesn't rescore`, async () => {
  await fixture(async ({ dir, out, called, execute, setKey }) => {
    await setKey(); await assert.rejects(execute(['judge'], { PREJUDGE_TEST_MODE: mode }), error => !error.stderr.includes(key));
    const failure = await readJson(join(out, 'failure.json')), result = await readJson(join(out, 'result.json'));
    assert.equal(failure.scored, true); assert.equal(failure.stage, 'explanation');
    assert.equal(result.explanationStatus, 'failed'); assert.equal(result.result.total, 32);
    await writeFile(called, ''); await execute(['explain', '--from', out], {}, join(dir, 'retry'));
    assert(!(await readFile(called, 'utf8')).includes('/v1/decisions'));
  });
});

for (const mode of ['no-key', 'too-large', 'missing']) test(`${mode} cannot produce a numeric score`, async () => {
  await fixture(async ({ out, called, execute, setKey }) => {
    if (mode !== 'no-key') await setKey();
    await assert.rejects(execute(['judge'], { PREJUDGE_TEST_MODE: mode }));
    assert.equal((await readJson(join(out, 'failure.json'))).scored, false);
    await assert.rejects(readFile(join(out, 'result.json')), /ENOENT/);
    if (mode === 'no-key') await assert.rejects(readFile(called), /ENOENT/);
    if (mode === 'too-large') assert(!(await readFile(called, 'utf8')).includes('/v1/decisions'));
  });
});

test('retry rejects modified scores before any API and private evidence always needs allow-private', async () => {
  await fixture(async ({ dir, out, called, execute, setKey }) => {
    await setKey(); await assert.rejects(execute(['judge']), /allow-private/);
    await execute(['judge', '--allow-private', '--scores-only']);
    const fixed = await readJson(join(out, 'decisions-result.json')); fixed.result.total = 40;
    await writeFile(join(out, 'decisions-result.json'), JSON.stringify(fixed)); await writeFile(called, '');
    await assert.rejects(execute(['explain', '--from', out, '--allow-private'], {}, join(dir, 'retry')), /Saved Decisions/);
    assert.equal(await readFile(called, 'utf8'), '');
  }, { visibility: 'private' });
});
