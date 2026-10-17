import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { finishSnapshot } from '../src/evidence.mjs';
import { rubric, rules } from '../src/scoring.mjs';
const run = promisify(execFile);

test('snapshot CLI never invokes model and refuses output overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'judge-cli-test-'));
  try {
    const s = finishSnapshot({ repo: 'fixture', url: null, pinnedSha: 'a'.repeat(40), defaultBranch: 'main', source: 'local-head', visibility: 'unknown', dirty: false,
      totalEntries: 1, selectedPaths: ['README.md'], files: [{ path: 'README.md', content: 'a', size: 1, originalSize: 1, truncated: false }], totalBytes: 1, omitted: [] });
    const input = join(dir, 'input.json'); await writeFile(input, JSON.stringify(s));
    const out = join(dir, 'output');
    const args = ['src/cli.mjs', 'snapshot', '--snapshot', input, '--out', out];
    const response = await run(process.execPath, args, { env: { ...process.env, PREJUDGE_CODEX_BIN: '/nonexistent' } });
    assert(response.stdout.includes('LLM採点は未実行'));
    assert.equal(JSON.parse(await readFile(join(out, 'evidence.json'), 'utf8')).pinnedSha, s.pinnedSha);
    await assert.rejects(run(process.execPath, args), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model tool activity fails without publishing a score', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'judge-tool-test-'));
  try {
    const fake = join(dir, 'fake-codex.mjs');
    await writeFile(fake, `#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('fake 1');process.exit(0)}\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));setTimeout(()=>process.exit(0),50)});\n`);
    await chmod(fake, 0o755);
    const s = finishSnapshot({ repo: 'fixture', url: null, pinnedSha: 'a'.repeat(40), defaultBranch: 'main', source: 'local-head', visibility: 'unknown', dirty: false,
      totalEntries: 1, selectedPaths: ['README.md'], files: [{ path: 'README.md', content: 'a', size: 1, originalSize: 1, truncated: false }], totalBytes: 1, omitted: [] });
    const input = join(dir, 'input.json'); await writeFile(input, JSON.stringify(s));
    const out = join(dir, 'output');
    await assert.rejects(run(process.execPath, [resolve('src/cli.mjs'), 'judge', '--snapshot', input, '--out', out], { env: { ...process.env, PREJUDGE_CODEX_BIN: fake } }), /ツール動作/);
    const failure = JSON.parse(await readFile(join(out, 'failure.json'), 'utf8'));
    assert.equal(failure.scored, false);
    await assert.rejects(readFile(join(out, 'result.json')), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('successful CLI validates final JSON and retains nonfatal runtime diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'judge-success-test-'));
  try {
    const answer = { summary: 'テスト結果。', criteria: rubric.criteria.map(c => ({ key: c.key, label: c.label, score: 1, reason: '材料あり。', evidencePaths: ['README.md'], gaps: [] })),
      total: 4, ruleChecks: rules.checks.map(c => ({ id: c.id, status: 'unknown', reason: '未確認。', evidencePaths: [] })),
      devdayUsage: { observed: '未確認。', evidencePaths: [], uncertainty: '追加確認。' }, improvements: [], uncertainties: ['稼働は未確認。'] };
    const fake = join(dir, 'fake-codex.mjs');
    await writeFile(fake, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nif(process.argv.includes('--version')){console.log('fake 1');process.exit(0)}\nprocess.stdin.resume();process.stdin.on('end',()=>{\nconsole.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'Nonfatal diagnostic'}}));\nwriteFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(${JSON.stringify(answer)}));\nconsole.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:10}}));\n});\n`);
    await chmod(fake, 0o755);
    const s = finishSnapshot({ repo: 'fixture', url: null, pinnedSha: 'a'.repeat(40), defaultBranch: 'main', source: 'local-head', visibility: 'unknown', dirty: false,
      totalEntries: 1, selectedPaths: ['README.md'], files: [{ path: 'README.md', content: 'a', size: 1, originalSize: 1, truncated: false }], totalBytes: 1, omitted: [] });
    const input = join(dir, 'input.json'); await writeFile(input, JSON.stringify(s));
    const out = join(dir, 'output');
    const response = await run(process.execPath, [resolve('src/cli.mjs'), 'judge', '--snapshot', input, '--out', out], { env: { ...process.env, PREJUDGE_CODEX_BIN: fake } });
    assert(response.stdout.includes('4 / 40'));
    const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8'));
    assert.deepEqual(result.runtime.warnings, ['Nonfatal diagnostic']);
    assert.equal(result.official, false);
    assert(!result.snapshot.files[0].content);
    assert((await readFile(join(out, 'report.md'), 'utf8')).includes('Nonfatal diagnostic'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
