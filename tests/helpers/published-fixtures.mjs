import { COLLECTOR, PUBLISHED_COMMIT, prepareFullSource } from '../../src/published-evidence.mjs';
import { profile } from '../../src/published-scoring.mjs';

export function fullEvidence({ files = [{ path: 'src/app.js', content: 'export function run(value) { return value.trim(); }' }], visibility = 'unknown' } = {}) {
  const prepared = prepareFullSource({ repo: { owner: 'fixture', repo: 'app', normalized: 'fixture/app', canonicalUrl: 'https://github.com/fixture/app' },
    assessment: 'scored', pinnedSha: 'a'.repeat(40), defaultBranch: 'main', summary: '架空の検証用ソース', fullSource: true,
    files: files.map(f => ({ ...f, size: Buffer.byteLength(f.content), truncated: false })) });
  return { formatVersion: 2, collector: COLLECTOR, policyCommit: PUBLISHED_COMMIT, source: 'local-head', visibility, dirty: false,
    capturedAt: '2026-10-19T00:00:00.000Z', totalEntries: files.length, candidateCount: files.length, omitted: [],
    snapshot: prepared.data, ...prepared.metadata };
}

export function predicates(overrides = {}) {
  return { model: profile.decisionsModel, status: 'completed', answers: profile.questions.map(q => ({
    name: q.name, type: 'predicate', probability: overrides[q.name] ?? (q.name === 'prompt_injection' ? 0.1 : q.name.endsWith('_10') ? 0.7 : 0.9)
  })), usage: { input_tokens: 1000, output_tokens: 0, total_tokens: 1000 } };
}

export function explanationResponse(fixed, path = 'src/app.js') {
  const explanation = { summary: '架空の入力処理を確認しました。', publicReason: '保存した固定点の説明です。',
    repoAssessment: fixed.repoAssessment, pinnedSha: fixed.pinnedSha, total: fixed.total, reviewRequired: false,
    criteria: fixed.criteria.map(c => ({ key: c.key, label: c.label, score: c.score,
      reason: '入力処理の実装を確認しました。次段階の条件は確認できません。', evidencePaths: [path] })) };
  return { model: profile.explanationModel, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(explanation) }] }],
    usage: { input_tokens: 1200, output_tokens: 100, total_tokens: 1300 } };
}
