# 公開審査コードへの対応範囲

確認日: 2026-10-19 JST。参照は[公開mainの固定コミット `23016a7dcfe71cf67a3d9405a84ff3b9021e203c`](https://github.com/schroneko/automated-hachathon-judge/tree/23016a7dcfe71cf67a3d9405a84ff3b9021e203c)。比較元の当ツールは `aab64d4528d562a4e0f81af02cd3bae1122cd493`。この文書はPRの実装仕様と差分であり、次回向けの個別の知見メモはGit管理対象に含めません。

## 差分と今回の対応

| 項目 | これまでの当ツール | 公開コード / published-v4での対応 |
|---|---|---|
| API質問 | 4軸のscoreと証拠・参加条件choice、12問 | 独立した20条件と攻撃判定、21 predicate |
| 点数 | 4軸×11段階の期待値、小数 | 0.8以上で成立。2・4・6・8・10点を順に確認し、最初の未達で停止 |
| 条件矛盾 | 分布・加重平均の整合検査 | 下位未達なのに上位成立なら要確認。点数を補正しない |
| 新機能参照 | 独自の基準と提出資料 | 主催者の `2026-10-18-verified-v2` をtechnicalの5問に限って挿入 |
| 収集範囲 | 上位24ファイル、切り詰めあり | フィルター後の全UTF-8。2000候補、本文3MiB、直列化4MiB。超過時は停止 |
| テスト | 通常のテキストとして選定対象になり得る | 17:50以降の標準テストパス除外。インライン部分とテスト結果はプロンプトで根拠から除外 |
| 素材 | SVGは対象になり得る | SVG等を取得前に除外。確認済みアセットはrepo＋SHA＋パスの一致時だけ除外 |
| 理由 | 既定の段階説明・ファイル候補のみ | Sol mediumが同じ全文・確定点を説明。点数・ラベル・SHA・合計変更を拒否 |
| 失敗 | API失敗時は採点未確定 | 点数確定前の失敗と、点数確定後の理由失敗を分離。理由だけ再実行可能 |
| 攻撃 | 過去コードの正規表現nuko-score | 独立したpredicate。確率0.8以上だけ80〜100を表示。40点へ加減しない |
| 監査 | SHA・rubricHash・requestHash | sourceHash・件数・容量・profileHash・移植実装ハッシュ・条件確率も保存 |

根拠: 上流の[段階条件](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/shared/decision-conditions.ts)、[質問と理由プロンプト](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/shared/prompt.ts)、[API処理](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/container/scorer.ts)、[収集フィルター](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/container/github.ts)、[新機能参照](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/shared/devday-reference.ts)。

## 当日の変更履歴

時刻はGitに記録された2026-10-18のJSTコミット時刻です。本番反映時刻そのものとは区別します。

| 時刻 | コミット | 変更 |
|---|---|---|
| 09:51:43 | [`cccfcfc`](https://github.com/schroneko/automated-hachathon-judge/commit/cccfcfc) | 10月版へ刷新。まだ24ファイル・1件12KB・全体120KBの選定方式。テスト用の除外条件はなく、対象拡張子なら選定され得る。PNG/JPEG等は除外。SVGはこの時点の許可拡張子に含まれない。 |
| 12:06:56 | [`8c0add2`](https://github.com/schroneko/automated-hachathon-judge/commit/8c0add21aec226616031259c7a5e2e4c7a82e6a7) | 2000候補・3MiBの全文方式へ。許可拡張子方式から除外形式のフィルターになり、SVGなどのUTF-8素材も入る状態に変化。テストも対象。 |
| 15:05:48 | [`9292bd7`](https://github.com/schroneko/automated-hachathon-judge/commit/9292bd75255d951b701e3b8fbf1c174c7fdef528) | v3の説明・基準に「実装されたテスト・利用例も根拠になる」を明記。 |
| 15:24:12 | [`ca75ff7`](https://github.com/schroneko/automated-hachathon-judge/commit/ca75ff7a748499d5a85405c717f72b4cba4bbef1) | SVG/SVGZ、画像・音声・動画・3D・モデル素材等の拡張子と生成ソースマップを取得前に除外。PNG/JPEGは新規除外ではない。 |
| 16:14:35 | [`fae30e7`](https://github.com/schroneko/automated-hachathon-judge/commit/fae30e75f4759915da9039fcc714f5e0019d742a) | v4へ。4軸の6段階choiceから、20条件のpredicateと連続段階判定へ変更。この時点ではテストを根拠に使える。 |
| 17:50:44 | [`339b953`](https://github.com/schroneko/automated-hachathon-judge/commit/339b9538f50d1b5b82bfe77bb6a936c00cef524f) | テストパスを全提出共通で除外。質問にもテストコード・結果・インラインテストを根拠にしないと明記。確認済み素材の限定除外を追加。rubricVersionはv4のまま。 |
| 17:50:44 | [`8e0ac30`](https://github.com/schroneko/automated-hachathon-judge/commit/8e0ac30763abf284293af2fb4a28664b8d551057) | 同じSHAで再採点し、旧スコア・証拠・試行を履歴保存する管理処理を追加。 |
| 18:02:36 | [`24d70c6`](https://github.com/schroneko/automated-hachathon-judge/commit/24d70c63acc068e44e7014cebc2379cb85758b2f) | 本番22件の再採点受付と、当時20件が理由まで完了した運用記録を追加。残り2件の完了を意味しない。 |
| 22:21–22:22 | [`d47f087`](https://github.com/schroneko/automated-hachathon-judge/commit/d47f087) / [`23016a7`](https://github.com/schroneko/automated-hachathon-judge/commit/23016a7dcfe71cf67a3d9405a84ff3b9021e203c) | 保存済み結果を読み取り専用の静的アーカイブとして公開。現在の本番へ再採点を送る仕組みとしては扱わない。 |

「最初からテスト・すべての画像が評価対象外だった」とは言えません。一方、SVGやBase64埋め込みのHTMLがテキストとして入力されることは、画像を視覚モデルで見たことや、テストを実行したこととは異なります。`coverage/`は早期から除外され、テスト結果のすべてが一律に読み込まれていたとも断定できません。

本番反映の裏付けは[容量調査と再採点の記録](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/docs/validation-capacity-assets-20261018.md)にあります。Worker版、操作ID、固定SHA維持、旧提出22件・旧スコア17件の履歴保存が記録されています。公開文書の記録であり、こちらが本番DBを直接照合したものではありません。

## 移植した範囲と残る違い

`src/published/`の条件・質問・参照・フィルター・実装有無判定・本文共有は、固定上流コードのJavaScript移植です。歴史的v2/v3理由プロンプトの再生成機能は外し、現在のv4のみ扱います。説明プロンプトは現在版の文面を維持します。`reference/published-20261018/`には12ファイルを改変せず保存し、チェックでSHA-256を照合します。以前の`reference/upstream/`40ファイルは変更していません。

- Git pack通信の代わりに、GitHub REST/rawまたはローカルGit blobを読みます。リダイレクト拒否、完全なtree、blobのGitハッシュ、UTF-8・容量を検査しますが、本番と同じ通信回数・期限・匿名アクセス条件ではありません。
- 審査対象ソースの保存形式はv2の監査用外枠を持ち、モデルへ渡す正規化スナップショットは上流の構造へ合わせます。`summary`やローカルのrepo識別子は本番と異なる可能性があるため、同じファイルでも本番sourceHashとの一致を保証しません。
- 不完全tree、取得失敗、容量超過、材料ゼロ、Private未承認などはローカル実行を停止します。上流の空・欠落repoの公開ゼロ点表示や提出状態管理は再現していません。
- 参加ルールを推測する追加のchoice質問はpublished-v4には加えません。機械的な実装有無と参加条件は分離し、点数へ追加加減しません。
- Queue/Container/D1/R2、予算予約・料金精算、管理APIによる一括再採点、ランキング・10位同点者全員通過、発表UIは対象外です。ローカルrunの不変保存と理由のみ再実行に限定します。
- 入力計数は上流と同じ安全式 `ceil(actual × 1.05) + 8192`、上限922,000、文脈上限1,050,000を固定方針として使います。最新価格やAPI全体の現在の制限を表す値ではありません。
- 今回は実API評価を実施していません。同一条件を再送した場合の得点・費用・モデル挙動の一致は未確認です。

## 上流内の不整合

最新版の[採点質問](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/shared/prompt.ts)と収集フィルターはテスト除外ですが、[説明用rubric.ts](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/src/shared/rubric.ts)および[説明文書](https://github.com/schroneko/automated-hachathon-judge/blob/23016a7dcfe71cf67a3d9405a84ff3b9021e203c/docs/judging-method.md)にはテストを使える記述が残っています。説明プロンプトの内部にも両方の文面が入ります。

このPRでは公開版の再現範囲を追えるよう原文を保持し、モデルがその矛盾を常に正しく解消すると保証しません。説明による採点の書き換えは拒否し、条件矛盾の要確認を消せないようにしています。今後その説明文を修正する場合は、公開版との一致を外れる変更として別のprofileHashで扱います。
