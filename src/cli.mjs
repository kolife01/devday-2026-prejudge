#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { collectGithub, collectLocal, validateSnapshot } from './evidence.mjs';
import { rubric, buildPrompt, validateResult } from './scoring.mjs';
import { runCodex } from './codex.mjs';
import { calculateNukoScore, visibleNukoScore } from './nuko-score.mjs';
import { coverageReport, renderReport } from './report.mjs';

const help = `DevDay 2026 非公式事前採点（仮の4項目40点）

  npm run snapshot -- --repo owner/repo
  npm run judge -- --repo owner/repo
  npm run judge -- --local /absolute/path/to/repository
  npm run judge -- --snapshot runs/previous/evidence.json

オプション:
  --allow-private         自分が読めるPrivateを準備用に評価（公開しない）
  --model gpt-6.1-sol      採点モデル。既定はGPT-6.1 Sol
  --effort medium         low / medium / high / xhigh
  --timeout 240           採点のタイムアウト秒（10〜900）
  --out runs/name         新しい出力フォルダ。既存フォルダは上書きしない

snapshotはLLMを呼ばず、GitHubの取得またはローカルHEADの読み取りだけを行います。
judgeはCodexログイン/利用枠を使い、リポジトリのテキスト証拠をモデルへ送信します。
ローカル入力もHEADのみ。未コミット変更・未追跡ファイルは読みません。
公式点数・予選通過予測ではありません。`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: 'string' }, local: { type: 'string' }, snapshot: { type: 'string' },
    'allow-private': { type: 'boolean' }, model: { type: 'string' }, effort: { type: 'string' },
    timeout: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) { console.log(help); return; }
  const command = positionals[0] ?? 'judge';
  if (!['judge', 'snapshot'].includes(command) || positionals.length > 1) throw new Error(help);
  if ([values.repo, values.local, values.snapshot].filter(Boolean).length !== 1) throw new Error('--repo / --local / --snapshot のいずれか1つを指定してください。\n' + help);
  const model = values.model ?? rubric.defaultModel;
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error('不正なモデル名です。');
  const effort = values.effort ?? 'medium';
  if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) throw new Error('effortはlow/medium/high/xhighです。');
  const timeout = Number(values.timeout ?? 240);
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 900) throw new Error('timeoutは10〜900秒の整数です。');
  console.error('リポジトリの評価材料を取得しています。対象のコードは実行しません。');
  const snapshot = validateSnapshot(values.repo ? await collectGithub(values.repo, { allowPrivate: values['allow-private'] }) :
    values.local ? await collectLocal(values.local) : JSON.parse(await readFile(resolve(values.snapshot), 'utf8')));
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const out = resolve(values.out ?? join('runs', `${stamp}-${snapshot.repo.replaceAll(/[^A-Za-z0-9_.-]/g, '-')}`));
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  const save = (name, value) => writeFile(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const prompt = buildPrompt(snapshot);
  await save('evidence.json', snapshot);
  await save('coverage.md', coverageReport(snapshot));
  await save('prompt.md', prompt);
  await save('rubric.json', rubric);
  const raw = calculateNukoScore(snapshot.files);
  await save('nuko-score.json', { raw, visible: visibleNukoScore(raw), affectsTotal: false });
  if (command === 'snapshot') {
    console.log(`評価材料を保存: ${out}\n${snapshot.files.length} files / ${snapshot.totalBytes} bytes / SHA ${snapshot.pinnedSha}\nLLM採点は未実行。`); return;
  }
  if (!snapshot.files.length) throw new Error(`評価できるテキストがありません。材料を ${out} に保存しました。採点は行っていません。`);
  console.error(`${model} (${effort}) で参考点を採点します。証拠: ${snapshot.files.length} files。`);
  try {
    const evaluated = await runCodex(prompt, { model, effort, timeoutMs: timeout * 1000,
      onProgress: phase => console.error(phase === 'thread.started' ? '採点セッションを開始しました。' : 'モデルの回答を検証しています。') });
    const result = validateResult(evaluated.result, snapshot);
    const envelope = { version: 1, official: false, createdAt: new Date().toISOString(), rubricId: rubric.id,
      sourceCommit: rubric.upstreamCommit,
      snapshot: { ...snapshot, files: snapshot.files.map(({ content, ...rest }) => rest) },
      runtime: evaluated.runtime, result, nukoScore: { raw, visible: visibleNukoScore(raw), affectsTotal: false } };
    await save('result.json', envelope);
    await save('report.md', renderReport(envelope));
    console.log(`参考点: ${result.total} / 40\nレポート: ${join(out, 'report.md')}\n読んだ範囲: ${join(out, 'coverage.md')}\n公式の採点基準・通過予測ではありません。`);
  } catch (error) {
    await save('failure.json', { completed: false, scored: false, error: error.message, requestedModel: model, at: new Date().toISOString() });
    throw new Error(`${error.message}\n採点は未確定です。保存済み材料: ${out}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
