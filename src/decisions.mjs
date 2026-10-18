export const DECISIONS_ENDPOINT = 'https://api.openai.com/v1/decisions';
const MAX_RESPONSE_BYTES = 1_000_000;
class DecisionError extends Error {}

async function readJson(response) {
  if (!response.body) throw new DecisionError('Decisions APIの応答本文がありません。');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new DecisionError('Decisions APIの応答がサイズ上限を超えました。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DecisionError('Decisions APIから有効なJSONが返りませんでした。'); }
}

function httpError(status) {
  const guidance = status === 401 ? '.envのOPENAI_API_KEYを確認してください。' :
    status === 403 ? 'APIプロジェクトのアクセス権を確認してください。' :
    status === 429 ? 'APIのレート制限・利用枠を確認し、後で明示的に再実行してください。' :
    status >= 500 ? 'OpenAI側の状態を確認し、後で明示的に再実行してください。' :
    status >= 300 && status < 400 ? 'リダイレクトには従いません。' : '保存したrequest.jsonとAPIの仕様を確認してください。';
  // Do not echo the provider's body: it can contain credentials or input data.
  return new DecisionError(`Decisions API: HTTP ${status}。${guidance} 自動再試行・別モデルへの切替は行いません。`);
}

export async function runDecisions(request, { apiKey = process.env.OPENAI_API_KEY, timeoutMs = 240_000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new DecisionError('.envのOPENAI_API_KEYが未設定です。.env.sampleを参考に設定してください。APIは呼んでいません。');
  if (/\s/.test(apiKey)) throw new DecisionError('OPENAI_API_KEYに空白や改行が含まれています。値を確認してください。');
  if (request.model !== 'gpt-6-luna') throw new DecisionError('Decisions APIの対応モデルはgpt-6-lunaです。');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) throw new DecisionError('Invalid API timeout');
  const controller = new AbortController();
  let timer;
  const started = Date.now();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new DecisionError('Decisions APIがタイムアウトしました。採点は未確定です。自動再試行は行いません。')); }, timeoutMs);
  });
  const operation = async () => {
    const response = await fetchImpl(DECISIONS_ENDPOINT, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request)
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw httpError(response.status);
    }
    const data = await readJson(response);
    const id = response.headers.get('x-request-id');
    return { response: data, runtime: { provider: 'openai', api: 'decisions', endpoint: DECISIONS_ENDPOINT,
      requestedModel: request.model, requestId: id && /^[A-Za-z0-9_-]{1,200}$/.test(id) && !id.includes(apiKey) ? id : null,
      durationMs: Date.now() - started, attempts: 1, mode: 'text-only-no-tools' } };
  };
  try { return await Promise.race([operation(), timeout]); }
  catch (error) {
    if (error instanceof DecisionError) throw error;
    if (controller.signal.aborted) throw new DecisionError('Decisions APIがタイムアウトしました。採点は未確定です。自動再試行は行いません。');
    throw new DecisionError('Decisions APIとの通信に失敗しました。接続を確認してください。自動再試行は行いません。');
  } finally { clearTimeout(timer); }
}
