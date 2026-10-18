import { rubric, rules } from './rubric.mjs';
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
  const status = { evidenced: '資料内の根拠あり', needs_action: '要対応', unknown: '未確認' };
  const pct = value => `${(value * 100).toFixed(1)}%`;
  return `# 事前採点: ${cell(s.repo)}\n\n**${r.total.toFixed(2)} / 40 点 — 公式4観点・本ツール独自の配点による参考値。公式点数・予選通過予測ではありません。**\n\n` +
    `${rubric.scaleNote}\n\nルール基準日: ${rules.asOf}。4観点の根拠: ユーザー提供本文（${rubric.source}）。\n\n` +
    `- 評価対象SHA: \`${s.pinnedSha}\`\n- 証拠ハッシュ: \`${s.contentHash}\`\n- 採点基準: ${rubric.id}\n- 基準ハッシュ: \`${envelope.rubricHash}\`\n- 送信内容ハッシュ: \`${envelope.requestHash}\`\n` +
    `- 採点: Decisions API / 指定モデル: ${runtime.requestedModel} / 応答モデル: ${runtime.reportedModel}\n- API request ID: ${runtime.requestId ?? 'なし'}\n- API入力トークン: ${runtime.usage.input_tokens}\n- 対象の公開状態: ${s.visibility}\n\n` +
    (s.dirty ? '**未コミット変更は含まれていません。ローカルHEADの評価です。**\n\n' : '') +
    '## 4カテゴリーの結果\n\n' +
    '点数は11段階の確率加重平均です。JSONには未丸め値を保存し、合計も未丸め値から計算します。以下の表示のみ小数2桁です。confidenceはAPIの値であり、通過確率や実測の正解率ではありません。\n\n' +
    '| 観点 | 点数 | confidence | 最頻段階 | 関連ファイル候補 |\n|---|---:|---:|---:|---|\n' +
    r.criteria.map(c => `| ${c.label} | ${c.score.toFixed(2)}/10 | ${pct(c.confidence)} | ${c.mostLikelyLevel.score} | ${c.evidencePaths.map(cell).join(', ') || '特定できず・要確認'} |`).join('\n') +
    '\n\n関連ファイル候補は独立したchoice質問の選択結果です。採点理由の引用や、そのファイルだけで点数を証明したという意味ではありません。特定できない場合も点数を作り直さず、未確認事項に残します。\n\n' +
    '## 点数に対応する基準と次の確認項目\n\n' +
    '**以下は設定済みの段階定義です。モデルが生成した作品固有の講評ではなく、次段階の条件も「未実装」と断定するものではありません。**\n\n' +
    r.criteria.map(c => `### ${c.label}\n\n最も確率が高い段階: **${c.mostLikelyLevel.score}点**（${pct(c.mostLikelyLevel.probability)}）。同率なら低い段階を表示します。\n\n` +
      `基準: ${c.mostLikelyLevel.description}\n\n` +
      (c.nextLevel ? `次段階（${c.nextLevel.score}点）に向けて確認する条件: ${c.nextLevel.description}` : '次段階はありません。10点の条件の裏付けと、分布の広がりを確認してください。') +
      `\n\n関連ファイル選択のconfidence: ${pct(c.evidenceConfidence)}\n\n| 段階 | 確率 |\n|---:|---:|\n` +
      c.probabilities.map(p => `| ${p.value} | ${pct(p.probability)} |`).join('\n')).join('\n\n') +
    '\n\n## 今回ルールとの適合確認（点数とは別）\n\n' +
    '理由欄は選択肢の定義またはメタデータです。Web公開の申告があってもサイト稼働の独立検証は行っていません。開発手段・公開歴・過去の提出歴・人数は人の確認を残します。\n\n' +
    '| 確認事項 | 状態 | 判定の意味 | 関連ファイル候補 |\n|---|---|---|---|\n' +
    r.ruleChecks.map(c => `| ${rules.checks.find(x => x.id === c.id).label} | ${status[c.status]} | ${cell(c.reason)} | ${c.evidencePaths.map(cell).join(', ') || '—'} |`).join('\n') +
    '\n\n## 未確認事項\n\n' + r.uncertainties.map(t => `- ${t}`).join('\n') +
    `\n\n## ぬこスコア\n\n${nukoScore.raw} / 100（上流での表示値: ${nukoScore.visible ?? '非表示'}）。正規表現による兆候検出であり、不正の確定・失格・40点への加減点ではありません。製品内のプロンプトやテスト文字列でも反応し得ます。\n\n` +
    '## 保存した資料\n\n[評価材料の範囲](coverage.md)、[API送信JSON](request.json)、[検証済みAPI応答](response.json)、[詳細な段階定義](rubric.json)。採点モデルの出力には揺らぎがあり、本番との一致は未検証です。\n';
}
