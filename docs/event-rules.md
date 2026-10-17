# 今回のルールと採点への反映

対象日: 2026-10-18、調査日: 2026-10-17（Asia/Tokyo）。[開催要項](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo)と[HawkieさんのQ&A記録](faq-notes.md)を使用。Q&Aは参加者による主催者回答の記録です。公開FAQで曖昧な点を確定事項へ置き換えません。

## 予選で見られるもの

- 公開GitHubリポジトリだけをLLMへ渡す。デプロイ済み成果物を操作するのは後段。[投稿](https://x.com/hawkymisc/status/2111406160054231526)
- 評価モデルはGPT-6.1系という説明。AIが読めるドキュメントを用意することが勧められている。[投稿](https://x.com/hawkymisc/status/2111400888963359028)
- 動画は予選LLMでは読み込まれない。外部API利用は可能。[投稿](https://x.com/hawkymisc/status/2111400190859157974)
- フロントとバックを別リポジトリにする方式は原則不可。モノレポにする。[投稿](https://x.com/hawkymisc/status/2111401428606672921)

## 成果物・開発・参加の条件

| 条件 | 根拠 | ツールの扱い |
|---|---|---|
| Webで公開されている成果物 | [Luma](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo) | デプロイ可能な実装と導線の記載を確認。サイト稼働は未検証 |
| Codex CLI/Appによる開発 | [Luma](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo) | 自己申告の所在を記録。開発履歴の独立検証はできずunknown |
| 自作ハーネス経由でCodexを呼ぶ開発は不可 | [FAQ](https://x.com/hawkymisc/status/2111403180592685509) | この採点ツールには作品の生成・修正ループを付けない |
| 事前準備は未公開の新規プロトタイプまで | [Luma](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo) | 公開履歴・当日制作範囲は人が確認。unknown |
| 2〜4人のチーム | [Luma](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo) | 登録情報を検証しない。unknown |
| ChatGPT SignInは可 | [FAQ](https://x.com/hawkymisc/status/2111406160054231526) | 使っていることを減点理由にしない |
| Webで動く形もある専用機向けゲームは可 | [FAQ](https://x.com/hawkymisc/status/2111405469491462257) | Web提供の有無を確認 |
| Visual Studio拡張だけの成果物は不可 | [FAQ](https://x.com/hawkymisc/status/2111405729211113942) | Web提供条件への不足として要対応 |
| スマホ連携は暫定的な回答 | [FAQ](https://x.com/hawkymisc/status/2111400342953099682) | Web公開条件と合わせ、個別確認を残す |

`evidenced`はリポジトリ内に根拠があるという意味で、すべての事実を独立検証したという意味ではありません。`needs_action`は対処が必要な材料がある状態、`unknown`は判断材料不足。公式の失格判定はしません。

## 未決定・未確認

- **審査基準そのものが未決定**という回答。[FAQ](https://x.com/hawkymisc/status/2111399354305298489)
- DevDay発表に関連する機能をどう加点するかも、この時点では未決定。[FAQ](https://x.com/hawkymisc/status/2111400888963359028)
- GPT-6.1の具体的なモデルID、effort、試行回数、集計方法。
- 24ファイル・サイズ制限・前回の4観点が今回も使われるか。
- 最終提出フォーム、締切直前の説明、審査対象コミットの確定方法。

本ツールは前回の4項目を各10点にした**仮の目安**を返します。DevDay利用の証拠を別に示しますが、未発表のボーナスを足しません。独自評価LLMについてFAQで言及されていることと、特定の採点プロンプトが公認されていることは別です。

## 提出前に整えること

1. 公開する提出repoの1箇所に、必要なフロント/バックの実装を集める。
2. 「誰の、どんな場面の、何が変わるか」をREADMEの冒頭で説明する。
3. 主要機能ごとに実装ファイルと操作手順を対応させる。予定は実装済みと分ける。
4. 動画・スクリーンショット・デモでしか伝わらない体験は、入出力と操作の説明も残す。
5. DevDay関連機能の役割、モデル/API、実装場所、確認済み範囲を記載する。
6. `snapshot`で読み込まれた範囲を確認し、`judge`の根拠不足を読む。
7. Web公開・ログイン・API制限は自分たちで実機確認する。予選でURLを開かないことは、Web公開要件の免除を意味しない。

これらは提出物の説明を実装の証拠に結びつけるための提案です。公式の新しい案内が出たら、その内容を優先してconfigと資料を更新してください。
