import { mkdtemp, cp, rm } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'devday-live-fixture-'));
try {
  await cp('tests/fixtures/demo', directory, { recursive: true });
  const git = args => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic evaluation fixture']);
  console.log(process.argv.includes('--dry-run')
    ? '架空サンプルの送信予定データを作成します。APIは呼びません。'
    : '架空サンプルをDecisions APIで採点します。.envのキーを使い、OpenAI API利用料が発生します。');
  const child = spawn(process.execPath, [resolve('src/cli.mjs'), 'judge', '--local', directory, ...process.argv.slice(2)], { stdio: 'inherit' });
  const code = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res); });
  process.exitCode = code ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
