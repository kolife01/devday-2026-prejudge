import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outputSchema } from './scoring.mjs';

export const disabledFeatures = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'memories', 'hooks',
  'multi_agent', 'multi_agent_v2', 'browser_use', 'computer_use', 'view_image', 'image_generation',
  'skill_search', 'goals', 'code_mode'];

export function codexArgs(directory, model, effort) {
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--model', model, '-C', directory, '--color', 'never', '--json',
    '--output-schema', join(directory, 'schema.json'), '--output-last-message', join(directory, 'answer.json'),
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '-c', `model_reasoning_effort="${effort}"`,
    ...disabledFeatures.flatMap(feature => ['--disable', feature]), '-'];
}

export function scorerEnvironment(env) {
  // Keep the user's login location, never copy auth data or pass GitHub credentials.
  return Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'CODEX_HOME', 'CODEX_API_KEY', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE']
    .filter(key => env[key]).map(key => [key, env[key]]));
}

export function runtimeError(message) {
  let text = String(message);
  try { const parsed = JSON.parse(text); text = parsed.error?.message ?? parsed.message ?? text; } catch { /* Already plain text. */ }
  if (text.includes('model is not supported') || /model.*not supported/.test(text)) {
    return new Error(`${text}\nこのCodexログインでは指定モデルを利用できません。自動で別モデルに切り替えません。snapshotの資料は保存済みです。利用可能なモデルを明示して --model で再実行できます。`);
  }
  return new Error(text);
}

export async function runCodex(prompt, { model, effort = 'medium', timeoutMs = 240_000, onProgress = () => {} }) {
  const directory = await mkdtemp(join(tmpdir(), 'devday-score-'));
  try {
    await writeFile(join(directory, 'schema.json'), JSON.stringify(outputSchema), { mode: 0o600 });
    const executable = process.env.PREJUDGE_CODEX_BIN || 'codex';
    const cliVersion = execFileSync(executable, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const { usage, threadId, modelReported, warnings } = await new Promise((resolve, reject) => {
      const child = spawn(executable, codexArgs(directory, model, effort), {
        cwd: directory, env: scorerEnvironment(process.env), stdio: ['pipe', 'pipe', 'pipe']
      });
      let pending = '', stderr = '', usage = null, threadId = null, modelReported = null, failure = null;
      const warnings = [];
      let killTimer;
      const timer = setTimeout(() => { failure = new Error('Codex採点がタイムアウトしました。点数は確定していません。'); child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000); }, timeoutMs);
      child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
      child.stdout.on('data', data => {
        pending += data.toString();
        if (pending.length > 2_000_000) { failure = new Error('Unexpectedly large Codex event'); child.kill('SIGTERM'); return; }
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          let event; try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'thread.started') threadId = event.thread_id;
          if (event.model) modelReported = event.model;
          if (event.type === 'turn.completed') usage = event.usage ?? null;
          if (event.type === 'turn.failed' || event.type === 'error') failure = runtimeError(event.error?.message ?? event.message ?? 'Codex failed');
          const itemType = event.item?.type;
          // An error item is a user-visible nonfatal diagnostic. turn.failed / exit status are fatal.
          if (itemType === 'error') warnings.push(String(event.item.message ?? 'Codex diagnostic').slice(0, 2000));
          if (itemType && !['agent_message', 'reasoning', 'error'].includes(itemType)) {
            failure = new Error(`証拠のみで採点する設定に反するツール動作 (${itemType}) を検出しました。`);
            child.kill('SIGTERM');
          }
          // Never persist reasoning / tool transcripts.
          if (event.type === 'thread.started' || event.type === 'turn.completed') onProgress(event.type);
        }
      });
      child.on('close', code => {
        clearTimeout(timer); clearTimeout(killTimer);
        if (failure) return reject(failure);
        if (code !== 0) return reject(new Error(`Codex終了コード ${code}: ${stderr.slice(-1800)}`));
        resolve({ usage, threadId, modelReported, warnings });
      });
      child.stdin.end(prompt);
    });
    const result = JSON.parse(await readFile(join(directory, 'answer.json'), 'utf8'));
    return { result, runtime: { requestedModel: model, reportedModel: modelReported, effort, cliVersion, usage, threadId, warnings,
      mode: 'ephemeral-read-only-no-tools', modelEvidence: modelReported ? 'runtime event' : 'requested model; no separate model field in CLI events' } };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
