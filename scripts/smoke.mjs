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
  console.log('架空サンプルを実モデルで採点します。Codexの利用枠を消費します。');
  const child = spawn(process.execPath, [resolve('src/cli.mjs'), 'judge', '--local', directory, ...process.argv.slice(2)], { stdio: 'inherit' });
  const code = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res); });
  process.exitCode = code ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
