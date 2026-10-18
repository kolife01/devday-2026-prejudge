import { finishSnapshot } from '../../src/evidence.mjs';

export function snapshot({ content = 'Synthetic task app. 入力した内容から結果を表示する。', visibility = 'unknown' } = {}) {
  return finishSnapshot({ repo: 'fixture/app', url: null, pinnedSha: 'a'.repeat(40), defaultBranch: 'main',
    source: 'local-head', visibility, dirty: false, totalEntries: 1, selectedPaths: ['README.md'],
    files: [{ path: 'README.md', content, size: Buffer.byteLength(content), originalSize: Buffer.byteLength(content), truncated: false }],
    omitted: [], totalBytes: Buffer.byteLength(content) });
}

export function decisionResponse(request, { scores = [7.4, 6.2, 8, 5.5], choices = {} } = {}) {
  let index = 0;
  return { model: request.model, answers: request.questions.map(q => {
    if (q.type === 'score') {
      const score = scores[index++];
      const lower = Math.floor(score), upper = Math.ceil(score);
      return { name: q.name, type: 'score', score, confidence: 0.8,
        probabilities: q.levels.map((l, i) => ({ value: i, label: l.label, probability: lower === upper ? Number(i === lower) : i === lower ? upper - score : i === upper ? score - lower : 0 })) };
    }
    const choice = choices[q.name] ?? (q.name.startsWith('rule_') ? 'unknown' : 'file_0');
    return { name: q.name, type: 'choice', choice, confidence: 0.7,
      probabilities: q.choices.map(c => ({ value: c.value, probability: Number(c.value === choice) })) };
  }), usage: { input_tokens: 300, output_tokens: 0, total_tokens: 300 } };
}
