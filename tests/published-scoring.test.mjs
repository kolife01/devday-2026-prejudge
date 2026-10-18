import test from 'node:test';
import assert from 'node:assert/strict';
import { fullEvidence, predicates, explanationResponse } from './helpers/published-fixtures.mjs';
import { profile, buildPublishedRequest, validatePublishedResponse, publishedResult, buildExplanationRequest,
  validateExplanationResponse } from '../src/published-scoring.mjs';
import { implementationEligibility } from '../src/published/eligibility.mjs';
import { validateTokenCount, callPublishedApi } from '../src/published-api.mjs';

test('published payload uses exactly 21 predicates; only technical questions receive trusted catalog', () => {
  const request = buildPublishedRequest(fullEvidence());
  assert.equal(request.questions.length, 21);
  assert(request.questions.every(q => q.type === 'predicate'));
  for (const q of request.questions) {
    assert.equal(q.instructions.includes('Trusted announced-feature reference:'), q.name.startsWith('technical_'));
    if (q.name !== 'prompt_injection') assert(q.instructions.includes('Test code and test results are outside evaluation'));
  }
  assert.equal(JSON.parse(request.input).fullSource, true);
});

test('threshold is inclusive, first failed prerequisite stops scoring, contradictions preserve review', () => {
  const r = publishedResult(predicates({ technical_level_2: 0.99, technical_level_4: 0.94, technical_level_6: 0.79,
    technical_level_8: 0.96, technical_level_10: 0.91, ux_level_8: 0.8, impact_level_2: 0.799999 }), fullEvidence());
  assert.deepEqual(r.criteria.map(c => c.score), [4, 8, 0, 8]);
  assert.equal(r.total, 20);
  assert.equal(r.reviewRequired, true);
  assert.equal(r.conditionChecks.ux_level_8, true);
});

test('all-false/all-true conditions span 0 to 40; injection never alters total or eligibility', () => {
  const levels = profile.questions.filter(q => q.name !== 'prompt_injection').map(q => q.name);
  const empty = publishedResult(predicates(Object.fromEntries(levels.map(n => [n, 0]))), fullEvidence());
  const full = publishedResult(predicates({ ...Object.fromEntries(levels.map(n => [n, 1])), prompt_injection: 0.8 }), fullEvidence());
  assert.equal(empty.total, 0); assert.equal(empty.reviewRequired, false);
  assert.equal(full.total, 40); assert.equal(full.attackScore, 80); assert.equal(full.eligibility, 'eligible');
  assert.equal(publishedResult(predicates({ prompt_injection: 0.7999 }), fullEvidence()).attackScore, null);
});

for (const [name, mutate] of Object.entries({
  missing: r => r.answers.pop(), duplicate: r => { r.answers[1] = r.answers[2]; },
  type: r => { r.answers[0].type = 'score'; }, range: r => { r.answers[0].probability = 1.1; },
  nan: r => { r.answers[0].probability = NaN; }, text: r => { r.answers[0].probability = '0.8'; },
  refusal: r => { r.answers[1].refusal = 'no'; }, incomplete: r => { r.status = 'incomplete'; },
  model: r => { r.model = 'other'; }, usage: r => { r.usage.output_tokens = 1; }
})) test(`predicate validation rejects ${name}`, () => {
  const response = predicates(); mutate(response);
  assert.throws(() => validatePublishedResponse(response));
});

test('lossless identical-content aliases preserve canonical source/hash and usable paths in both stages', () => {
  const evidence = fullEvidence({ files: [{ path: 'src/a.js', content: 'export const value = 1;' }, { path: 'src/b.js', content: 'export const value = 1;' }] });
  const before = JSON.stringify(evidence), request = buildPublishedRequest(evidence);
  const input = JSON.parse(request.input);
  assert.equal(input.files[1].sameContentAs, 'src/a.js'); assert.equal(input.files[1].content, undefined);
  assert(request.questions.every(q => q.instructions.includes('sameContentAs means')));
  const fixed = publishedResult(predicates(), evidence);
  const second = buildExplanationRequest(evidence, fixed);
  assert.deepEqual(JSON.parse(second.input[1].content).snapshot, input);
  const explained = validateExplanationResponse(explanationResponse(fixed, 'src/b.js'), evidence, fixed);
  assert.equal(explained.result.sourceHash, evidence.sourceHash);
  assert.equal(JSON.stringify(evidence), before);
});

test('implementation eligibility is a separate conservative file heuristic', () => {
  const docs = fullEvidence({ files: [{ path: 'README.md', content: 'Perfect application' }, { path: 'next.config.js', content: 'export default {}' }] });
  assert.equal(implementationEligibility(docs.snapshot), 'no_implementation');
  const result = publishedResult(predicates(), docs);
  assert.equal(result.total, 32); assert.equal(result.eligibility, 'no_implementation');
  const book = fullEvidence({ files: [{ path: 'analysis.ipynb', content: JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(1)'] }] }) }] });
  assert.equal(implementationEligibility(book.snapshot), 'eligible');
});

test('Sol explanation cannot clear a condition contradiction or change the original fixed result', () => {
  const evidence = fullEvidence(), fixed = publishedResult(predicates({ technical_level_4: 0.1 }), evidence);
  const before = JSON.stringify(fixed);
  const result = validateExplanationResponse(explanationResponse(fixed), evidence, fixed);
  assert.equal(result.result.reviewRequired, true);
  assert.equal(result.result.total, fixed.total);
  assert.equal(JSON.stringify(fixed), before);
  assert.equal(buildExplanationRequest(evidence, fixed).reasoning.effort, 'medium');
});

for (const [name, mutate] of Object.entries({
  score: r => { r.criteria[0].score += 2; }, label: r => { r.criteria[0].label = 'Changed'; },
  sha: r => { r.pinnedSha = 'b'.repeat(40); }, total: r => { r.total = 40; },
  path: r => { r.criteria[0].evidencePaths = ['missing.js']; },
  noEvidence: r => { r.criteria[0].evidencePaths = []; },
  long: r => { r.criteria[0].reason = '理由'.repeat(141); },
  notJapanese: r => { r.criteria[0].reason = 'Looks fine'; },
  extra: r => { r.sourceHash = 'fake'; }, duplicate: r => { r.criteria[1] = r.criteria[0]; }
})) test(`explanation validation rejects ${name}`, () => {
  const evidence = fullEvidence(), fixed = publishedResult(predicates(), evidence), response = explanationResponse(fixed);
  const body = JSON.parse(response.output[0].content[0].text); mutate(body);
  response.output[0].content[0].text = JSON.stringify(body);
  assert.throws(() => validateExplanationResponse(response, evidence, fixed));
});

test('an explanation can acknowledge missing evidence with review, but cannot silently switch sources', () => {
  const evidence = fullEvidence(), fixed = publishedResult(predicates(), evidence), response = explanationResponse(fixed);
  const body = JSON.parse(response.output[0].content[0].text);
  body.criteria[0].evidencePaths = []; body.reviewRequired = true;
  response.output[0].content[0].text = JSON.stringify(body);
  assert.equal(validateExplanationResponse(response, evidence, fixed).result.reviewRequired, true);
  assert.throws(() => buildExplanationRequest(fullEvidence({ files: [{ path: 'src/app.js', content: 'changed' }] }), fixed), /metadata/);
});

test('token guard uses counted input with 5% plus 8192 safety margin, never bytes as tokens', () => {
  assert.equal(validateTokenCount({ input_tokens: 799510 }, 'gpt-6-luna', 0).conservativeBound, 847678);
  assert.throws(() => validateTokenCount({ input_tokens: 883194 }, 'gpt-6-luna', 0), /capacity/);
  assert.throws(() => validateTokenCount({ input_tokens: 0 }, 'gpt-6-luna', 0));
  assert.throws(() => validateTokenCount({ input_tokens: 100, model: 'other' }, 'gpt-6-luna', 0));
});

test('new API client restricts redirects, sanitizes provider failures and bounds body timeout', async () => {
  const key = 'offline-test-key';
  await assert.rejects(callPublishedApi('responses', { model: 'gpt-6.1-sol' }, { apiKey: key, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.redirect, 'manual');
    return new Response(key, { status: 401 });
  } }), error => error.message.includes('HTTP 401') && !error.message.includes(key));
  await assert.rejects(callPublishedApi('responses', { model: 'gpt-6.1-sol' }, { apiKey: key, timeoutMs: 20,
    fetchImpl: async () => new Response(new ReadableStream({ start() {} })) }), /タイムアウト/);
  await assert.rejects(callPublishedApi('other', {}, { apiKey: key }), /Unsupported/);
});
