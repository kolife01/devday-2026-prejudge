import { profile } from './published-scoring.mjs';

const paths = new Set(['decisions', 'responses', 'responses/input_tokens']);
class ApiError extends Error {}

// Only these fixed OpenAI endpoints are supported. Never send the key to redirects.
export async function callPublishedApi(path, body, { apiKey = process.env.OPENAI_API_KEY, timeoutMs = 240_000, fetchImpl = globalThis.fetch } = {}) {
  if (!paths.has(path)) throw new ApiError('Unsupported API endpoint');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ApiError('.envのOPENAI_API_KEYが未設定です。APIは呼んでいません。');
  if (/\s/.test(apiKey)) throw new ApiError('OPENAI_API_KEYに空白・改行があります。');
  if (![profile.decisionsModel, profile.explanationModel].includes(body.model) ||
      (path === 'decisions' && body.model !== profile.decisionsModel) || (path === 'responses' && body.model !== profile.explanationModel)) throw new ApiError('Unexpected API model');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) throw new ApiError('Invalid API timeout');
  const controller = new AbortController(), started = Date.now();
  const endpoint = `https://api.openai.com/v1/${path}`;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ApiError(`${path}: タイムアウトしました。自動再試行は行いません。`)); }, timeoutMs);
  });
  const operation = async () => {
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new ApiError(`${path}: HTTP ${response.status}。キー・アクセス権・API利用枠を確認してください。自動再試行は行いません。`);
    }
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1_000_000) throw new ApiError(`${path}: API応答のサイズ上限を超えました。`);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ApiError(`${path}: API応答が有効なJSONではありません。`); }
    const id = response.headers.get('x-request-id');
    return { data, runtime: { api: path, requestedModel: body.model, durationMs: Date.now() - started, attempts: 1,
      requestId: id && /^[A-Za-z0-9_-]{1,200}$/.test(id) && !id.includes(apiKey) ? id : null } };
  };
  try { return await Promise.race([operation(), timeout]); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`${path}: APIとの通信に失敗しました。自動再試行は行いません。`);
  } finally { clearTimeout(timer); }
}

export function validateTokenCount(data, model, outputCap) {
  if (!data || data.error != null || data.refusal != null || data.incomplete_details != null ||
      (data.status !== undefined && data.status !== 'completed') || (data.model !== undefined && data.model !== model) ||
      !Number.isSafeInteger(data.input_tokens) || data.input_tokens <= 0) throw new Error('Invalid/incomplete input token count');
  // Same conservative bounds as the published judge. These are policy, not current model pricing.
  const bound = Number((BigInt(data.input_tokens) * 105n + 99n) / 100n + 8192n);
  if (!Number.isSafeInteger(bound) || bound > 922_000 || bound + outputCap > 1_050_000) throw new Error('Input exceeds published token/context capacity; no partial scoring');
  return { inputTokens: data.input_tokens, conservativeBound: bound, outputCap };
}

export async function countPublishedInput(request, options) {
  const input = request.questions ? [
    { role: 'developer', content: JSON.stringify(request.questions) }, { role: 'user', content: request.input }
  ] : request.input;
  const call = await callPublishedApi('responses/input_tokens', { model: request.model, input }, options);
  return { ...validateTokenCount(call.data, request.model, request.max_output_tokens ?? 0), model: request.model, runtime: call.runtime };
}
