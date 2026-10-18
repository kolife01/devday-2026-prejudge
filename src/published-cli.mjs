import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { rules, jsonHash } from './rubric.mjs';
import { collectPublishedGithub, collectPublishedLocal, validateFullEvidence } from './published-evidence.mjs';
import { profile, profileHash, buildPublishedRequest, validatePublishedResponse, publishedResult,
  buildExplanationRequest, buildExplanationPreflight, validateExplanationResponse } from './published-scoring.mjs';
import { countPublishedInput, callPublishedApi } from './published-api.mjs';
import { publishedCoverage, makePublishedEnvelope, renderPublishedReport } from './published-report.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export async function runPublished(command, values) {
  if (!['snapshot', 'judge', 'explain'].includes(command)) throw new Error('Use snapshot, judge or explain');
  const resuming = command === 'explain';
  if (resuming ? (!values.from || [values.repo, values.local, values.snapshot, values['scores-only']].some(Boolean)) :
    (values.from || [values.repo, values.local, values.snapshot].filter(Boolean).length !== 1)) {
    throw new Error(resuming ? 'explainには --from runs/PREVIOUS のみ指定してください。' : '--repo / --local / --snapshot のいずれか1つを指定してください。');
  }
  if (values.model && values.model !== profile.decisionsModel) throw new Error('Decisions APIの対応モデルはgpt-6-lunaです。');
  const timeout = Number(values.timeout ?? 240);
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 900) throw new Error('timeoutは10〜900秒の整数です。');
  const options = { timeoutMs: timeout * 1000 };
  console.error(resuming ? '保存済みの点数とソースを照合します。Decisionsの再採点は行いません。' : '固定コミットから対象UTF-8ソースを全文取得します。対象コードは実行しません。');
  const from = resuming ? resolve(values.from) : null;
  const evidence = validateFullEvidence(resuming ? await readJson(join(from, 'evidence.json')) :
    values.repo ? await collectPublishedGithub(values.repo, { allowPrivate: values['allow-private'] }) :
    values.local ? await collectPublishedLocal(values.local) : await readJson(resolve(values.snapshot)));
  if (evidence.visibility === 'private' && !values['allow-private']) throw new Error('Privateスナップショットには --allow-private が必要です。');
  const request = buildPublishedRequest(evidence);
  let fixed, decisionEnvelope, decisionResponse;
  if (resuming) {
    const previousRequest = await readJson(join(from, 'request.json'));
    decisionResponse = validatePublishedResponse(await readJson(join(from, 'response.json')));
    decisionEnvelope = await readJson(join(from, 'decisions-result.json'));
    fixed = publishedResult(decisionResponse, evidence);
    if (decisionEnvelope.version !== 4 || decisionEnvelope.profileId !== profile.id || decisionEnvelope.profileHash !== profileHash ||
        decisionEnvelope.sourceCommit !== profile.upstreamCommit || decisionEnvelope.requestHash !== jsonHash(request) ||
        jsonHash(previousRequest) !== jsonHash(request) || jsonHash(decisionEnvelope.result) !== jsonHash(fixed)) {
      throw new Error('Saved Decisions/provenance differs; explanation retry cannot change evidence or profile');
    }
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const out = resolve(values.out ?? join('runs', `${stamp}-${evidence.snapshot.repo.normalized.replaceAll('/', '-')}${resuming ? '-explain' : ''}`));
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  const save = (name, value) => writeFile(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  let scored = Boolean(fixed);
  let stage = 'preparation';
  const runtime = resuming ? { decisions: decisionEnvelope.runtime.decisions, preflight: [], resumedFrom: from } : { preflight: [] };
  const saveResult = async (result, status) => {
    const envelope = makePublishedEnvelope(evidence, result, runtime, status, { requestHash: jsonHash(request) });
    await save('result.json', envelope);
    await save('report.md', renderPublishedReport(envelope));
    return envelope;
  };
  try {
    await save('evidence.json', evidence);
    await save('coverage.md', publishedCoverage(evidence));
    await save('profile.json', profile);
    await save('event-rules.json', rules);
    await save('request.json', request);
    const future = resuming ? buildExplanationRequest(evidence, fixed) : buildExplanationPreflight(evidence);
    await save(resuming ? 'explanation-request.json' : 'explanation-preflight-request.json', future);
    if (resuming) {
      await save('response.json', decisionResponse);
      await save('decisions-result.json', decisionEnvelope);
    }
    if (command === 'snapshot' || values['dry-run']) {
      console.log(`評価材料と送信予定JSONを保存: ${out}\n${evidence.sourceFiles} files / ${evidence.sourceBytes} bytes / SHA ${evidence.snapshot.pinnedSha}\nAPI採点は未実行（キー不要）。${resuming ? '' : '理由用preflightの40点は容量確認専用の仮置きで、採点結果ではありません。'}`);
      return;
    }
    try { loadEnvFile(resolve('.env')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('.envを読み込めません。'); }
    if (!resuming) {
      stage = 'input-preflight';
      runtime.preflight.push(await countPublishedInput(request, options));
      await save('preflight.json', runtime.preflight);
      if (!values['scores-only']) runtime.preflight.push(await countPublishedInput(future, options));
      await save('preflight.json', runtime.preflight);
      stage = 'decisions';
      console.error('Decisionsの21 predicateを評価し、連続成立する段階から点数を確定します。');
      const call = await callPublishedApi('decisions', request, options);
      decisionResponse = validatePublishedResponse(call.data);
      fixed = publishedResult(decisionResponse, evidence);
      runtime.decisions = { ...call.runtime, usage: decisionResponse.usage };
      await save('response.json', decisionResponse);
      decisionEnvelope = makePublishedEnvelope(evidence, fixed, runtime, 'pending', { requestHash: jsonHash(request) });
      await save('decisions-result.json', decisionEnvelope);
      scored = true;
    }
    // Scores survive any later token-count, network, validation or explanation failure.
    await saveResult(fixed, values['scores-only'] ? 'skipped' : 'pending');
    if (!values['scores-only']) {
      stage = 'explanation';
      const explanationRequest = buildExplanationRequest(evidence, fixed);
      await save('explanation-request.json', explanationRequest);
      runtime.preflight.push(await countPublishedInput(explanationRequest, options));
      await save('preflight.json', runtime.preflight);
      console.error('GPT-6.1 Sol mediumで、固定点を変更せず日本語の理由を生成します。');
      const call = await callPublishedApi('responses', explanationRequest, options);
      const explained = validateExplanationResponse(call.data, evidence, fixed);
      runtime.explanation = { ...call.runtime, usage: explained.usage };
      await save('explanation.json', explained.explanation);
      await saveResult(explained.result, 'completed');
    }
    console.log(`参考点: ${fixed.total} / 40\nレポート: ${join(out, 'report.md')}\n公開コード ${profile.upstreamCommit.slice(0, 7)} の参考実装です。公式結果ではありません。`);
  } catch (error) {
    await save('failure.json', { completed: false, scored, stage, error: error.message, at: new Date().toISOString() });
    if (scored && stage === 'explanation') await saveResult(fixed, 'failed');
    throw new Error(`${error.message}\n${scored ? 'Decisionsの点数は保存済みです。理由だけ再実行: node src/cli.mjs explain --from ' + out : '採点は未確定です。'}\n保存先: ${out}`);
  }
}
