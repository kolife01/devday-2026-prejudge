import test from 'node:test';
import assert from 'node:assert/strict';
import { runDecisions, DECISIONS_ENDPOINT } from '../src/decisions.mjs';
import { buildDecisionRequest } from '../src/scoring.mjs';
import { snapshot, decisionResponse } from './helpers/fixtures.mjs';
const request = buildDecisionRequest(snapshot());
const key = 'test-only-not-a-real-key';

test('HTTP client makes one authenticated POST with no redirect or unsupported params', async () => {
  let count = 0;
  const result = await runDecisions(request, { apiKey: key, fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, DECISIONS_ENDPOINT); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
    assert.deepEqual(options.headers, { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), request); assert(!options.body.includes(key));
    assert(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(decisionResponse(request)), { headers: { 'x-request-id': 'req_test' } });
  } });
  assert.equal(count, 1); assert.equal(result.runtime.attempts, 1);
  assert.equal(result.runtime.requestId, 'req_test'); assert(!JSON.stringify(result).includes(key));
});

test('missing or invalid keys fail without calling fetch or echoing the value', async () => {
  let count = 0;
  for (const apiKey of ['', ' ', 'test\nsecret']) await assert.rejects(runDecisions(request, { apiKey, fetchImpl: async () => count++ }), /OPENAI_API_KEY/);
  assert.equal(count, 0);
});

for (const status of [400, 401, 403, 429, 500, 503, 302]) test(`HTTP ${status} is not retried and does not log provider error bodies or keys`, async () => {
  let count = 0;
  await assert.rejects(runDecisions(request, { apiKey: key, fetchImpl: async () => {
    count++; return new Response(`Secret: ${key} candidate-private-input`, { status, headers: { location: 'https://untrusted.invalid' } });
  } }), error => error.message.includes(`HTTP ${status}`) && !error.message.includes(key) && !error.message.includes('candidate-private-input'));
  assert.equal(count, 1);
});

test('network exception details cannot leak credentials', async () => {
  await assert.rejects(runDecisions(request, { apiKey: key, fetchImpl: async () => { throw new Error(`header ${key}`); } }), e => e.message.includes('通信に失敗') && !e.message.includes(key));
});

test('timeout aborts a stalled fetch without retry', async () => {
  let signal;
  await assert.rejects(runDecisions(request, { apiKey: key, timeoutMs: 15, fetchImpl: async (_, options) => {
    signal = options.signal; return new Promise(() => {});
  } }), /タイムアウト/);
  assert(signal.aborted);
});

test('timeout covers a stalled response body', async () => {
  let cancelled = false;
  // Abort closes the body as native fetch does.
  await assert.rejects(runDecisions(request, { apiKey: key, timeoutMs: 15, fetchImpl: async (_, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => { cancelled = true; controller.error(new Error('aborted')); }); }
  })) }), /タイムアウト/);
  assert(cancelled);
});

test('non-JSON and oversized bodies fail rather than being scored', async () => {
  await assert.rejects(runDecisions(request, { apiKey: key, fetchImpl: async () => new Response(`not-json ${key}`) }), e => e.message.includes('JSON') && !e.message.includes(key));
  await assert.rejects(runDecisions(request, { apiKey: key, fetchImpl: async () => new Response('a'.repeat(1_000_001)) }), /サイズ上限/);
});
