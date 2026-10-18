import { DECISION_CONDITIONS } from './published/decision-conditions.mjs';
import { profile, profileHash } from './published-scoring.mjs';
import { rules } from './rubric.mjs';

const md = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_{}\[\]()#!|]/g, '\\$&').replaceAll('\n', ' ');

export function publishedCoverage(evidence) {
  return '# 評価材料の範囲\n\n' +
    `収集方針: ${profile.collector}\n\n固定SHA: ${evidence.snapshot.pinnedSha}\n\nsourceHash: ${evidence.sourceHash}\n\n` +
    `${evidence.sourceFiles}ファイル / ${evidence.sourceBytes} bytes。全対象UTF-8本文を保持し、切り詰めはありません。\n\n` +
    `取得元: ${md(evidence.source)} / 公開状態: ${md(evidence.visibility)} / 未コミット変更: ${evidence.dirty === null ? '未検査' : evidence.dirty ? 'あり（評価対象外）' : 'なし'}\n\n` +
    '2026-10-18 17:50以降の除外方針です。テスト・テスト結果は根拠に使いません。製品内のインラインテストは本文に残りますがプロンプトで評価対象外にします。標準名に当たらないテストや結果ファイルをすべて自動判別するものではありません。リンク先・画面・動画を見たり、対象コードやテストを実行したりしていません。\n\n' +
    '| 読み込んだパス | bytes |\n|---|---:|\n' + evidence.snapshot.files.map(f => `| ${md(f.path)} | ${f.size} |`).join('\n') +
    '\n\n| 除外パス | 理由 |\n|---|---|\n' + evidence.omitted.map(f => `| ${md(f.path)} | ${md(f.reason)} |`).join('\n') + '\n';
}

export function participationChecks(evidence) {
  return rules.checks.map(check => ({ id: check.id, label: check.label, status: check.id === 'public_repository' && evidence.source === 'github'
    ? evidence.visibility === 'public' ? 'pass' : 'fail' : 'unknown',
  note: check.id === 'public_repository' && evidence.source === 'github' ? '収集時のGitHubメタデータ。現在の公開状態は再確認が必要です。' : 'モデル採点とは独立。別途、人による確認が必要です。' }));
}

export function makePublishedEnvelope(evidence, result, runtime, explanationStatus, extra = {}) {
  return { version: 4, official: false, profileId: profile.id, profileHash, sourceCommit: profile.upstreamCommit,
    rubricVersion: profile.rubricVersion, referenceVersion: profile.referenceVersion, createdAt: new Date().toISOString(),
    snapshot: { repo: evidence.snapshot.repo, pinnedSha: evidence.snapshot.pinnedSha, sourceHash: evidence.sourceHash,
      sourceFiles: evidence.sourceFiles, sourceBytes: evidence.sourceBytes, fullSource: true, collector: evidence.collector },
    result, runtime, explanationStatus, rulesAsOf: rules.asOf, participationChecks: participationChecks(evidence), ...extra };
}

export function renderPublishedReport(envelope) {
  const r = envelope.result;
  const blocks = r.criteria.map(c => {
    const conditions = DECISION_CONDITIONS.filter(d => d.key === c.key);
    const blocked = conditions.find(d => !r.conditionChecks[d.name]);
    return `## ${c.label}: ${c.score} / 10\n\n` +
      (envelope.explanationStatus === 'completed' ? `${md(c.reason)}\n\n根拠: ${c.evidencePaths.length ? c.evidencePaths.map(md).join(', ') : '未特定（要確認）'}\n\n` : '作品固有の理由は未生成です。以下は条件とAPIの確率であり、自由文の講評ではありません。\n\n') +
      '| 段階 | 条件の確率 | 成立 |\n|---:|---:|---|\n' + conditions.map(d => `| ${d.level} | ${r.conditionProbabilities[d.name]} | ${r.conditionChecks[d.name] ? 'はい' : 'いいえ'} |`).join('\n') +
      `\n\n${blocked ? `最初の未達条件（${blocked.level}点）: ${md(blocked.description)}` : '10点までの条件が連続して成立しています。'}\n`;
  });
  return '# 公開コード準拠の参考採点\n\n' +
    `**${r.total} / 40点** / 理由: ${md(envelope.explanationStatus)} / 要確認: ${r.reviewRequired ? 'あり' : 'なし'}\n\n` +
    `対象: ${md(envelope.snapshot.repo.normalized)} / SHA: ${r.pinnedSha}\n\n` +
    `審査コード: ${profile.upstreamCommit} / rubric: ${profile.rubricVersion} / profileHash: ${profileHash}\n\n` +
    `sourceHash: ${r.sourceHash} / ${r.sourceFiles} files / ${r.sourceBytes} bytes\n\n` +
    'これはローカルの参考結果です。過去の公式点数・順位や同一得点の再現を保証しません。確率0.8以上の条件を2点から順に確認し、最初の不成立で停止します。確率は通過確率・実測正解率ではありません。\n\n' +
    (r.summary ? `${md(r.summary)}\n\n${md(r.publicReason)}\n\n` : '') + blocks.join('\n') +
    `\n## 点数とは別の判定\n\n実装ファイル判定: ${r.eligibility}。機械的なファイル判定であり、参加資格全体の確認ではありません。\n\n` +
    `攻撃指示の確率: ${r.attackProbability} / 表示値: ${r.attackScore ?? '非表示（0.8未満）'}。40点に加減せず、攻撃の成功確率でもありません。\n\n` +
    '| 参加条件 | 状態 |\n|---|---|\n' + envelope.participationChecks.map(c => `| ${md(c.label)} | ${c.status} |`).join('\n') +
    '\n\nunknownは合格や自動失格を意味しません。ソース除外・入力上限・プロンプトの版が違う結果を、作品だけの改善として比較しないでください。対象コード、テスト、Webサイトは実行・操作していません。\n';
}
