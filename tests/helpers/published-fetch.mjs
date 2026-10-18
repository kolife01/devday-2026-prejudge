// Offline-only preload; runtime has no endpoint override or live-test mode.
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { predicates, explanationResponse } from './published-fixtures.mjs';

globalThis.fetch = async (url, options) => {
  const path = new URL(url).pathname;
  assert.equal(new URL(url).origin, 'https://api.openai.com');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Authorization, `Bearer ${process.env.PREJUDGE_TEST_EXPECT_KEY}`);
  assert(!options.body.includes(process.env.PREJUDGE_TEST_EXPECT_KEY));
  if (process.env.PREJUDGE_TEST_CALLED) await appendFile(process.env.PREJUDGE_TEST_CALLED, path + '\n');
  const request = JSON.parse(options.body), mode = process.env.PREJUDGE_TEST_MODE;
  let data;
  if (path === '/v1/responses/input_tokens') {
    data = { model: request.model, input_tokens: mode === 'too-large' ? 1_000_000 : 1000 };
  } else if (path === '/v1/decisions') {
    assert.equal(request.questions.length, 21); data = predicates();
    if (mode === 'missing') data.answers.pop();
  } else if (path === '/v1/responses') {
    if (mode === 'explanation-http') return new Response(process.env.PREJUDGE_TEST_EXPECT_KEY, { status: 500 });
    const input = JSON.parse(request.input[1].content);
    data = explanationResponse(input.fixedScores, input.snapshot.files[0].path);
    if (mode === 'explanation-score') {
      const result = JSON.parse(data.output[0].content[0].text); result.total = 40;
      data.output[0].content[0].text = JSON.stringify(result);
    }
  } else throw new Error('Unexpected endpoint');
  return new Response(JSON.stringify(data), { headers: { 'x-request-id': 'req_offline_only' } });
};
