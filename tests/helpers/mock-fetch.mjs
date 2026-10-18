// Explicit Node --import test preload. No endpoint override exists in production.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { decisionResponse } from './fixtures.mjs';
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/decisions');
  assert.equal(options.headers.Authorization, `Bearer ${process.env.PREJUDGE_TEST_EXPECT_KEY}`);
  assert.equal(options.redirect, 'manual');
  const request = JSON.parse(options.body);
  assert(!options.body.includes(process.env.PREJUDGE_TEST_EXPECT_KEY));
  if (process.env.PREJUDGE_TEST_CALLED) await writeFile(process.env.PREJUDGE_TEST_CALLED, 'called');
  const data = decisionResponse(request);
  switch (process.env.PREJUDGE_TEST_MODE) {
    case 'refusal': data.answers[0] = { type: 'refusal', name: 'new_features' }; break;
    case 'missing': data.answers.pop(); break;
    case 'unauthorized': return new Response(`secret: ${process.env.PREJUDGE_TEST_EXPECT_KEY}`, { status: 401 });
  }
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'x-request-id': 'req_test_only' } });
};
