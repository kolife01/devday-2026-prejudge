import { jsonHash } from './rubric.mjs';
import { readFileSync } from 'node:fs';
import { PUBLISHED_COMMIT, COLLECTOR, sourceLimits, validateFullEvidence } from './published-evidence.mjs';
import { CRITERIA } from './published/constants.mjs';
import { DECISION_CONDITIONS, CONDITION_PROBABILITY_THRESHOLD, deriveConditionScores } from './published/decision-conditions.mjs';
import { DEVDAY_REFERENCE_VERSION } from './published/devday-reference.mjs';
import { RUBRIC_VERSION } from './published/rubric.mjs';
import { buildDecisionsQuestions, buildExplanationPrompt } from './published/prompt.mjs';
import { packModelEvidence, SHARED_CONTENT_INSTRUCTIONS } from './published/model-evidence.mjs';
import { implementationEligibility } from './published/eligibility.mjs';
import { explanationOutputSchema } from './published/explanation-schema.mjs';

export const profile = {
  id: 'published-v4', upstreamCommit: PUBLISHED_COMMIT, collector: COLLECTOR,
  implementationHash: jsonHash(['published-evidence.mjs', 'published-scoring.mjs', 'published-api.mjs', 'published-cli.mjs', 'published-report.mjs',
    ...['constants', 'decision-conditions', 'devday-reference', 'eligibility', 'explanation-schema', 'filters', 'model-evidence', 'prompt', 'reviewed-assets', 'rubric']
      .map(name => `published/${name}.mjs`)].map(path => [path, readFileSync(new URL(path, import.meta.url), 'utf8')])),
  rubricVersion: RUBRIC_VERSION, referenceVersion: DEVDAY_REFERENCE_VERSION,
  decisionsModel: 'gpt-6-luna', explanationModel: 'gpt-6.1-sol', explanationEffort: 'medium',
  conditionThreshold: CONDITION_PROBABILITY_THRESHOLD, limits: sourceLimits,
  conditions: DECISION_CONDITIONS, questions: buildDecisionsQuestions(),
  explanationPrompt: buildExplanationPrompt(), sharedContentInstructions: SHARED_CONTENT_INSTRUCTIONS
};
export const profileHash = jsonHash(profile);

export function buildPublishedRequest(evidence) {
  validateFullEvidence(evidence);
  const packed = packModelEvidence(evidence.snapshot);
  return { model: profile.decisionsModel, input: JSON.stringify(packed.data), questions: profile.questions.map(q =>
    ({ ...q, instructions: packed.shared ? `${q.instructions}\n${SHARED_CONTENT_INSTRUCTIONS}` : q.instructions })) };
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model object');
  return value;
}

function complete(value, model, required = false) {
  record(value);
  if (value.error != null || value.refusal != null || value.incomplete_details != null ||
      (value.status !== undefined && value.status !== 'completed') || (required && value.status !== 'completed') ||
      (value.model !== undefined && value.model !== model)) throw new Error('Model response was refused, incomplete or from an unexpected model');
}

function probability(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid predicate probability');
  return value;
}

export function validateUsage(value, decisions = false) {
  record(value);
  for (const key of ['input_tokens', 'output_tokens']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error('Invalid API token usage');
  if (decisions && value.output_tokens !== 0) throw new Error('Decisions must report zero output tokens');
  const total = value.input_tokens + value.output_tokens;
  if (!Number.isSafeInteger(total) || (value.total_tokens !== undefined && value.total_tokens !== total)) throw new Error('Inconsistent API token usage');
  return { input_tokens: value.input_tokens, output_tokens: value.output_tokens, total_tokens: total };
}

export function validatePublishedResponse(value) {
  complete(value, profile.decisionsModel);
  if (!Array.isArray(value.answers) || value.answers.length !== 21) throw new Error('Decisions must return exactly 21 predicates');
  const expected = new Set(profile.questions.map(q => q.name)), byName = new Map();
  for (const answer of value.answers) {
    complete(answer, profile.decisionsModel);
    if (!expected.delete(answer.name) || answer.type !== 'predicate') throw new Error('Missing, duplicate or unexpected predicate');
    byName.set(answer.name, { name: answer.name, type: 'predicate', probability: probability(answer.probability) });
  }
  return { model: profile.decisionsModel, answers: profile.questions.map(q => byName.get(q.name)), usage: validateUsage(value.usage, true) };
}

export function publishedResult(response, evidence) {
  validateFullEvidence(evidence);
  const checked = validatePublishedResponse(response);
  const probabilities = Object.fromEntries(checked.answers.filter(a => a.name !== 'prompt_injection').map(a => [a.name, a.probability]));
  const conditions = Object.fromEntries(Object.entries(probabilities).map(([name, p]) => [name, p >= CONDITION_PROBABILITY_THRESHOLD]));
  const derived = deriveConditionScores(conditions);
  const attackProbability = checked.answers.find(a => a.name === 'prompt_injection').probability;
  return {
    repoAssessment: 'scored', pinnedSha: evidence.snapshot.pinnedSha,
    eligibility: implementationEligibility(evidence.snapshot),
    criteria: CRITERIA.map(({ key, label }) => ({ key, label, score: derived.scores[key], reason: '採点理由は未生成です。', evidencePaths: [] })),
    total: Object.values(derived.scores).reduce((sum, value) => sum + value, 0),
    reviewRequired: derived.reviewRequired, conditionChecks: conditions, conditionProbabilities: probabilities,
    conditionThreshold: CONDITION_PROBABILITY_THRESHOLD, attackProbability,
    attackScore: attackProbability >= 0.8 ? Math.round(attackProbability * 100) : null,
    sourceHash: evidence.sourceHash, sourceFiles: evidence.sourceFiles, sourceBytes: evidence.sourceBytes, fullSource: true
  };
}

// Recompute the immutable fields from the recorded probabilities before explaining.
export function validateFixedResult(fixed, evidence) {
  record(fixed);
  const synthetic = { model: profile.decisionsModel, usage: { input_tokens: 0, output_tokens: 0 },
    answers: profile.questions.map(q => ({ name: q.name, type: 'predicate', probability: q.name === 'prompt_injection' ? fixed.attackProbability : fixed.conditionProbabilities?.[q.name] })) };
  const derived = publishedResult(synthetic, evidence);
  for (const key of ['repoAssessment', 'pinnedSha', 'eligibility', 'total', 'conditionThreshold', 'attackProbability', 'attackScore', 'sourceHash', 'sourceFiles', 'sourceBytes', 'fullSource']) {
    if (fixed[key] !== derived[key]) throw new Error('Fixed scores/source metadata do not match recorded evidence');
  }
  if (typeof fixed.reviewRequired !== 'boolean' || (derived.reviewRequired && !fixed.reviewRequired) ||
      !Array.isArray(fixed.criteria) || fixed.criteria.length !== 4) throw new Error('Invalid fixed review/criteria');
  for (const field of ['conditionChecks', 'conditionProbabilities']) {
    record(fixed[field]);
    if (Object.keys(fixed[field]).length !== 20 || DECISION_CONDITIONS.some(({ name }) => fixed[field][name] !== derived[field][name])) throw new Error('Fixed condition evidence differs');
  }
  for (const [i, criterion] of derived.criteria.entries()) {
    if (['key', 'label', 'score'].some(key => criterion[key] !== fixed.criteria[i]?.[key])) throw new Error('Fixed criterion scores or labels differ');
  }
  return fixed;
}

function explanationBody(evidence, fixedScores, checks, probabilities) {
  const packed = packModelEvidence(evidence.snapshot);
  return { model: profile.explanationModel, reasoning: { effort: 'medium' }, max_output_tokens: 8192, store: false,
    input: [
      { role: 'developer', content: profile.explanationPrompt + (packed.shared ? `\n\n${SHARED_CONTENT_INSTRUCTIONS}` : '') },
      { role: 'user', content: JSON.stringify({ snapshot: packed.data, fixedScores, conditionChecks: checks,
        conditionProbabilities: probabilities, conditionThreshold: CONDITION_PROBABILITY_THRESHOLD }) }
    ], text: { format: { type: 'json_schema', name: 'hackathon_explanation', strict: true, schema: explanationOutputSchema } } };
}

export function buildExplanationRequest(evidence, fixed) {
  validateFixedResult(fixed, evidence);
  return explanationBody(evidence, { repoAssessment: fixed.repoAssessment, pinnedSha: fixed.pinnedSha,
    criteria: fixed.criteria.map(({ key, label, score }) => ({ key, label, score })), total: fixed.total }, fixed.conditionChecks, fixed.conditionProbabilities);
}

export function buildExplanationPreflight(evidence) {
  validateFullEvidence(evidence);
  return explanationBody(evidence, { repoAssessment: 'scored', pinnedSha: evidence.snapshot.pinnedSha,
    criteria: CRITERIA.map(({ key, label }) => ({ key, label, score: 10 })), total: 40 },
  Object.fromEntries(DECISION_CONDITIONS.map(c => [c.name, true])), Object.fromEntries(DECISION_CONDITIONS.map(c => [c.name, 1])));
}

function exactKeys(value, keys) {
  record(value);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Unexpected explanation fields');
}

export function validateExplanationResponse(response, evidence, fixed) {
  validateFixedResult(fixed, evidence);
  complete(response, profile.explanationModel, true);
  if (!Array.isArray(response.output)) throw new Error('Responses output is missing');
  const texts = [];
  for (const item of response.output) {
    record(item);
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || !Array.isArray(item.content)) throw new Error('Unexpected Responses output');
    for (const part of item.content) {
      if (part.type !== 'output_text' || typeof part.text !== 'string' || part.refusal != null) throw new Error('Responses explanation was refused');
      texts.push(part.text);
    }
  }
  if (texts.length !== 1) throw new Error('Responses must return exactly one explanation JSON');
  let explained;
  try { explained = JSON.parse(texts[0]); } catch { throw new Error('Invalid explanation JSON'); }
  exactKeys(explained, ['summary', 'publicReason', 'repoAssessment', 'pinnedSha', 'criteria', 'total', 'reviewRequired']);
  if (['summary', 'publicReason'].some(k => typeof explained[k] !== 'string' || !explained[k].trim() || explained[k].length > 400) ||
      typeof explained.reviewRequired !== 'boolean' || !Array.isArray(explained.criteria) || explained.criteria.length !== 4 ||
      ['repoAssessment', 'pinnedSha', 'total'].some(key => explained[key] !== fixed[key])) throw new Error('Explanation changed fixed scores/SHA or has invalid fields');
  const paths = new Set(evidence.snapshot.files.map(f => f.path)), seen = new Set();
  for (const item of explained.criteria) {
    exactKeys(item, ['key', 'label', 'score', 'reason', 'evidencePaths']);
    const original = fixed.criteria.find(c => c.key === item.key);
    if (!original || seen.has(item.key) || original.label !== item.label || original.score !== item.score) throw new Error('Explanation changed fixed criterion');
    seen.add(item.key);
    if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 280 || !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(item.reason) ||
        !Array.isArray(item.evidencePaths) || item.evidencePaths.length > 24 || item.evidencePaths.some(path => !paths.has(path))) throw new Error('Invalid Japanese reason or unknown evidence path');
    if (!item.evidencePaths.length && !explained.reviewRequired) throw new Error('Missing evidence requires reviewRequired');
  }
  if (fixed.eligibility === 'no_implementation' && fixed.total > 0 && !explained.reviewRequired) throw new Error('No implementation support requires reviewRequired');
  // Explicit allowlist: the model can supply prose, existing paths and an additional review flag only.
  const result = { ...fixed, summary: explained.summary, publicReason: explained.publicReason,
    criteria: fixed.criteria.map(c => explained.criteria.find(item => item.key === c.key)),
    reviewRequired: fixed.reviewRequired || explained.reviewRequired };
  return { result, explanation: explained, usage: validateUsage(response.usage) };
}

export function renderPublishedRubric() {
  const cell = value => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return '# 公開審査コードの4カテゴリーと段階条件\n\n' +
    '<!-- Generated from src/published/decision-conditions.mjs by npm run rubric. -->\n\n' +
    `参照コミット: \`${PUBLISHED_COMMIT}\` / 基準: \`${RUBRIC_VERSION}\` / 新機能参照: \`${DEVDAY_REFERENCE_VERSION}\`。\n\n` +
    '各条件の確率が0.8以上なら成立。2・4・6・8・10点の順に、最初の不成立で止まります。最初の条件が不成立なら0点です。上位条件だけ成立しても飛び越しません。下位不成立・上位成立の矛盾は要確認として残します。4軸合計40点。確率を点数として平均しません。\n\n' +
    'これは2026-10-18 17:50の変更後の条件です。それ以前はテストも根拠に使えました。現在の採点質問はテストコード・テスト結果（製品内のインラインテストも含む）を対象外と明記しています。APIへ送る正確な英文は各runのrequest.jsonで確認できます。条件のdescription/guidanceを質問へ追加する独自変更はしていません。\n\n' +
    CRITERIA.map(c => `## ${c.label}\n\n${c.focus}\n\n| 点 | 追加条件 |\n|---:|---|\n| 0 | 最低の2点条件が成立しない |\n` +
      DECISION_CONDITIONS.filter(d => d.key === c.key).map(d => `| ${d.level} | ${cell(d.description)} |`).join('\n')).join('\n\n') +
    '\n\n説明用ルーブリックには旧来の「テストも根拠になる」という文言が残っています。参照実装を追跡できるよう原文を保持し、矛盾を[実装差分](published-judge.md)に記録しています。このツールの点数は主催者の公式結果ではありません。\n';
}
