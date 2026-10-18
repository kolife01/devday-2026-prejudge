import { rubric, rules } from './scoring.mjs';
const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function coverageReport(s) {
  return `# 評価材料の範囲\n\n対象: ${s.repo}\n\nSHA: \`${s.pinnedSha}\` / source: ${s.source} / visibility: ${s.visibility}\n\n` +
    `取得: ${s.files.length} / ${s.totalEntries} エントリー、${s.totalBytes.toLocaleString()} bytes。\n\n` +
    (s.dirty ? '**未コミット変更があります。この採点はローカルHEADだけを読みます。変更中のファイルは含みません。**\n\n' : '') +
    '上流の優先順位と文字切り詰めを再現しています。10月の実際の収集方式が同じとは未確認です。秘密情報の典型的なファイル名とsymlinkは追加で除外します。\n\n' +
    '| 読み込んだファイル | bytes | 途中省略 |\n|---|---:|---|\n' +
    s.files.map(f => `| ${cell(f.path)} | ${f.size} | ${f.truncated ? 'あり' : 'なし'} |`).join('\n') +
    '\n\n## 読み込まれなかったファイル\n\n' + s.omitted.map(f => `- ${cell(f.path)}: ${f.reason}`).join('\n') + '\n';
}

export function renderReport(envelope) {
  const { snapshot: s, result: r, runtime, nukoScore } = envelope;
  const status = { evidenced: 'リポジトリ内の根拠あり', needs_action: '要対応', unknown: '未確認' };
  return `# 事前採点: ${s.repo}\n\n**${r.total} / 40 点 — 公式4観点・仮の配点による参考値。公式点数・予選通過予測ではありません。**\n\n` +
    `${rubric.scaleNote}\n\nルール基準日: ${rules.asOf}。4観点の根拠はユーザー提供の確定ルール本文（${rubric.source}）。\n\n` +
    `${r.summary}\n\n` +
    `- 評価対象SHA: \`${s.pinnedSha}\`\n- 証拠ハッシュ: \`${s.contentHash}\`\n- 取得方式: ${s.source} / ${s.collector}\n- 採点モデル指定: ${runtime.requestedModel} / effort: ${runtime.effort}\n- 実行環境: ${runtime.cliVersion}\n- 採点基準: ${rubric.id}\n- 対象の公開状態: ${s.visibility}\n- 実行時モデル情報: ${runtime.reportedModel ?? 'CLIイベントに独立したモデル名なし（上記は指定値）'}\n\n` +
    (s.dirty ? '**未コミット変更は含まれていません。ローカルHEADの評価です。**\n\n' : '') +
    '| 観点 | 点数 | 理由 | 根拠 |\n|---|---:|---|---|\n' +
    r.criteria.map(c => `| ${c.label} | ${c.score}/10 | ${cell(c.reason)} | ${c.evidencePaths.map(cell).join(', ')} |`).join('\n') +
    '\n\n## 項目別の不足\n\n' + r.criteria.map(c => `### ${c.label}\n\n${c.gaps.length ? c.gaps.map(g => `- ${g}`).join('\n') : '追加の不足指摘なし。'}`).join('\n\n') +
    '\n\n## 今回ルールとの適合確認（点数とは別）\n\n' +
    '| 確認事項 | 状態 | 理由 | 根拠 |\n|---|---|---|---|\n' +
    r.ruleChecks.map(c => `| ${rules.checks.find(x => x.id === c.id).label} | ${status[c.status]} | ${cell(c.reason)} | ${c.evidencePaths.map(cell).join(', ')} |`).join('\n') +
    '\n\n## 新機能の活用の根拠\n\n' + r.devdayUsage.observed + '\n\n根拠: ' + r.devdayUsage.evidencePaths.join(', ') + '\n\n' + r.devdayUsage.uncertainty +
    '\n\n## 次に直すこと\n\n' + r.improvements.map(c => `- **${c.priority}: ${c.title}** — ${c.action}\n  - 理由: ${c.reason}\n  - 根拠: ${c.evidencePaths.join(', ') || '材料不足のため確認が必要'}`).join('\n') +
    '\n\n## 未確認事項\n\n' + r.uncertainties.map(t => `- ${t}`).join('\n') +
    `\n\n## ぬこスコア\n\n${nukoScore.raw} / 100（上流での表示値: ${nukoScore.visible ?? '非表示'}）。正規表現による兆候検出であり、不正の確定・失格・40点への加減点ではありません。製品内のプロンプトやテスト文字列でも反応し得ます。\n\n` +
    (runtime.warnings?.length ? '## 実行時の診断\n\n' + runtime.warnings.map(w => `- ${w}`).join('\n') + '\n\n' : '') +
    '## 制約\n\nコード・テスト・デモは実行していません。外部リンク、画像、動画も見ていません。Gitの履歴・未コミット変更は評価材料に含みません。公開サイトの稼働と、人による参加ルール確認は別途必要です。毎回のLLM採点には揺らぎがあります。\n';
}
