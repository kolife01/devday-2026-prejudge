#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadEnvFile } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { collectGithub, collectLocal, validateSnapshot } from './evidence.mjs';
import { rubric, rules, rubricHash, jsonHash } from './rubric.mjs';
import { buildPrompt, buildDecisionRequest, validateDecisionResponse, resultFromDecisions } from './scoring.mjs';
import { runDecisions } from './decisions.mjs';
import { calculateNukoScore, visibleNukoScore } from './nuko-score.mjs';
import { coverageReport, renderReport } from './report.mjs';

const help = `DevDay 2026 非公式事前採点（Decisions API / 4観点・各0〜10点）

  npm run snapshot -- --repo owner/repo
  npm run judge -- --repo owner/repo --dry-run
  npm run judge -- --repo owner/repo
  npm run judge -- --local /absolute/path/to/repository
  npm run judge -- --snapshot runs/previous/evidence.json

オプション:
  --dry-run               judgeの送信内容だけ保存（キー不要・APIを呼ばない）
  --allow-private         Privateを準備用に評価（公開しない）
  --model gpt-6-luna      Decisions API対応モデル。既定もgpt-6-luna
  --timeout 240           APIのタイムアウト秒（10〜900）
  --out runs/name         新しい出力フォルダ。既存フォルダは上書きしない

.env.sampleを.envへコピーし、OPENAI_API_KEYを設定してください。
実行したディレクトリの.envを自動読込します。既存の環境変数を優先します。
snapshotと--dry-runはOpenAI APIを呼びません。GitHub取得は行います。
judgeはAPIへリポジトリのテキストを送り、OpenAI API利用料が発生します。
Codexログインは不要。--effortは廃止しました。
ローカル入力はHEADのみ。未コミット変更・未追跡ファイルは読みません。
公式点数・予選通過予測ではありません。`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: 'string' }, local: { type: 'string' }, snapshot: { type: 'string' },
    'allow-private': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, model: { type: 'string' },
    timeout: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) { console.log(help); return; }
  const command = positionals[0] ?? 'judge';
  if (!['judge', 'snapshot'].includes(command) || positionals.length > 1) throw new Error(help);
  if ([values.repo, values.local, values.snapshot].filter(Boolean).length !== 1) throw new Error('--repo / --local / --snapshot のいずれか1つを指定してください。\n' + help);
  const model = values.model ?? rubric.defaultModel;
  if (model !== 'gpt-6-luna') throw new Error('Decisions APIの対応モデルはgpt-6-lunaです。別モデルへ自動切替しません。');
  const timeout = Number(values.timeout ?? 240);
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 900) throw new Error('timeoutは10〜900秒の整数です。');
  console.error('リポジトリの評価材料を取得しています。対象のコードは実行しません。');
  const snapshot = validateSnapshot(values.repo ? await collectGithub(values.repo, { allowPrivate: values['allow-private'] }) :
    values.local ? await collectLocal(values.local) : JSON.parse(await readFile(resolve(values.snapshot), 'utf8')));
  if (snapshot.visibility === 'private' && !values['allow-private']) throw new Error('Privateスナップショットには --allow-private が必要です。');
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const out = resolve(values.out ?? join('runs', `${stamp}-${snapshot.repo.replaceAll(/[^A-Za-z0-9_.-]/g, '-')}`));
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  const save = (name, value) => writeFile(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const raw = calculateNukoScore(snapshot.files);
  const nukoScore = { raw, visible: visibleNukoScore(raw), affectsTotal: false };
  await save('evidence.json', snapshot);
  await save('coverage.md', coverageReport(snapshot));
  await save('rubric.json', rubric);
  await save('event-rules.json', rules);
  await save('nuko-score.json', nukoScore);
  try {
    // Even snapshot-only mode records the exact questions and levels used next time.
    // An empty snapshot remains inspectable, but never produces a score request.
    if (!snapshot.files.length) {
      if (command === 'snapshot' || values['dry-run']) {
        console.log(`評価材料を保存: ${out}\n評価可能なテキスト0件。request.jsonは作成せず、API採点は未実行。`); return;
      }
      throw new Error('評価できるテキストがありません。APIは呼んでいません。');
    }
    const request = buildDecisionRequest(snapshot, { model });
    await save('request.json', request);
    await save('prompt.md', buildPrompt(request));
    if (command === 'snapshot' || values['dry-run']) {
      console.log(`評価材料と送信予定JSONを保存: ${out}\n${snapshot.files.length} files / ${snapshot.totalBytes} bytes / SHA ${snapshot.pinnedSha}\nAPI採点は未実行（キー不要）。`); return;
    }
    try { loadEnvFile(resolve('.env')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('.envを読み込めません。ファイルと読み取り権限を確認してください。'); }
    console.error(`Decisions API (${model}) で参考点を採点します。証拠: ${snapshot.files.length} files。`);
    const evaluated = await runDecisions(request, { timeoutMs: timeout * 1000 });
    const response = validateDecisionResponse(evaluated.response, request);
    const result = resultFromDecisions(response, snapshot);
    const envelope = { version: 3, official: false, createdAt: new Date().toISOString(), rubricId: rubric.id, rubricHash,
      requestHash: jsonHash(request), criteriaOfficial: rubric.criteriaOfficial, scoringScaleOfficial: rubric.scoringScaleOfficial,
      rulesAsOf: rules.asOf, sourceCommit: rubric.upstreamCommit,
      snapshot: { ...snapshot, files: snapshot.files.map(({ content, ...rest }) => rest) },
      runtime: { ...evaluated.runtime, reportedModel: response.model, usage: response.usage }, result, nukoScore };
    const report = renderReport(envelope);
    await save('response.json', response);
    await save('report.md', report);
    await save('result.json', envelope);
    console.log(`参考点: ${result.total.toFixed(2)} / 40\nレポート: ${join(out, 'report.md')}\n読んだ範囲: ${join(out, 'coverage.md')}\n公式4観点・本ツール独自の配点による参考点です。`);
  } catch (error) {
    await save('failure.json', { completed: false, scored: false, error: error.message, requestedModel: model, api: 'decisions', at: new Date().toISOString() });
    throw new Error(`${error.message}\n採点は未確定です。保存済み材料: ${out}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
