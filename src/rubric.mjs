import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const keys = ['new_features', 'usability', 'usefulness', 'originality'];
export function validateRubric(value) {
  if (!value || value.official !== false || value.criteriaOfficial !== true || value.scoringScaleOfficial !== false ||
      !Array.isArray(value.criteria) || value.criteria.length !== 4 || !Array.isArray(value.evaluationPolicy) || !value.evaluationPolicy.length) {
    throw new Error('Invalid rubric metadata');
  }
  for (const [index, c] of value.criteria.entries()) {
    if (c.key !== keys[index] || c.max !== 10 || !c.label || !c.focus || !c.guidance || !Array.isArray(c.levels) || c.levels.length !== 11) {
      throw new Error('Each official criterion needs 11 levels from 0 to 10');
    }
    for (const [score, level] of c.levels.entries()) {
      if (level.label !== String(score) || typeof level.description !== 'string' || !level.description.trim()) throw new Error('Invalid rubric level');
    }
    if (new Set(c.levels.map(l => l.description)).size !== 11) throw new Error('Adjacent rubric levels must be distinct');
  }
  return value;
}

export const rubric = validateRubric(JSON.parse(readFileSync(new URL('../config/rubric.json', import.meta.url), 'utf8')));
export const rules = JSON.parse(readFileSync(new URL('../config/event-rules.json', import.meta.url), 'utf8'));
export const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const rubricHash = jsonHash(rubric);

export function renderRubricDocument() {
  const cell = text => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return '# 4カテゴリー・0〜10点の採点基準\n\n' +
    '<!-- Generated from config/rubric.json by npm run rubric. Do not edit the tables by hand. -->\n\n' +
    `基準ID: \`${rubric.id}\`\n\n${rubric.scaleNote}\n\n` +
    '[公式4観点の出典](../reference/event-rules-2026-10-18.md)。以下の詳細定義は本ツールで作成したものです。\n\n' +
    '## 点数の決め方\n\n' + rubric.scoreMethod + '\n\n' +
    'たとえば7点の確率が60%、8点が40%なら7.4点です。「7点基準を満たす」と断定する値ではありません。レポートには最も確率が高い段階（同率なら低い方）、その定義、全段階の確率とconfidenceも表示します。confidenceはAPIの値で、正解率や本番予選の通過確率ではありません。\n\n' +
    '## 共通の判断方針\n\n' + rubric.evaluationPolicy.map(p => `- ${p}`).join('\n') + '\n\n' +
    rubric.criteria.map(c => `## ${c.label}\n\n**${c.focus}**\n\n${c.guidance}\n\n| 点 | 判断基準 |\n|---:|---|\n` +
      c.levels.map(l => `| ${l.label} | ${cell(l.description)} |`).join('\n')).join('\n\n') +
    '\n\n## 実装との対応\n\n正本は[config/rubric.json](../config/rubric.json)です。APIの4つのscore質問は、このファイルのlevelsを変更せず使用します。この文書も同じ設定から生成し、`npm run check`で一致を確認します。変更時は`npm run rubric`を実行してください。\n\n' +
    '段階の定義と次段階の確認項目は定型文であり、モデルが書いた自由文の講評ではありません。取得した証拠の収集範囲は各runのcoverage.md、送信する全質問と本文はrequest.jsonで確認できます。\n';
}
