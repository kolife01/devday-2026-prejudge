# DevDay 2026 参考採点ツール

公開された[審査コード `23016a7`](https://github.com/schroneko/automated-hachathon-judge/tree/23016a7dcfe71cf67a3d9405a84ff3b9021e203c)に合わせ、固定コミットのソースから4観点を評価するCLIです。**Decisionsで点数を確定し、GPT-6.1 Solで日本語の理由を書きます。** 公式結果・順位の再現を保証するものではありません。

既定は `published-v4`。従来の独自44段階の採点は `--profile legacy-44` で利用できます。

| 項目 | published-v4（既定） | legacy-44（従来方式） |
|---|---|---|
| 採点 | 20段階条件＋独立した攻撃判定、計21 predicate | 4 score＋関連ファイル・参加条件のchoice、計12質問 |
| 点数 | 各0 / 2 / 4 / 6 / 8 / 10、合計40点 | 各0〜10の11段階の期待値、合計40点 |
| 判定方法 | 確率0.8以上を成立とし、2点から連続した最高段階 | 段階の確率を加重平均した小数 |
| 入力 | 対象UTF-8全文、最大2000候補・本文3MiB・JSON4MiB | 優先順位上位24件、各12,000 UTF-16単位で切り詰め |
| 理由 | 同じ保存済みソースをSol mediumへ渡す | 定義と関連ファイル候補。自由文の理由なし |
| 基準 | 公開実装の2026-10-18最終方針 | 本ツール独自の仮基準 |

**テスト除外はイベント途中の変更です。** テストを根拠に使える版が先に存在し、10/18 15:24にSVGなどの素材除外、17:50にテストコード・テスト結果の除外が追加されました。PNG/JPEGなどはそれ以前から除外されています。コミット時刻と本番反映の記録は[実装差分と時系列](docs/published-judge.md)に整理しています。

## セットアップ

Node.js 22以上、Gitが必要です。GitHubから直接収集する場合はGitHub CLI `gh` も使います。npm依存パッケージやCodexログインは不要です。

```bash
git clone https://github.com/kolife01/devday-2026-prejudge.git
cd devday-2026-prejudge
cp .env.sample .env
```

初回だけコピーし、`.env` の `OPENAI_API_KEY=` にキーを記入します。既存の`.env`は上書きしないでください。実行ディレクトリの`.env`を自動読込し、同名の環境変数があればそちらを優先します。`.env` / `.env.*`はGit管理対象外、`.env.sample`のキーは空欄です。

## まず送信内容を確認

```bash
npm run snapshot -- --repo OWNER/REPO
npm run judge -- --local /absolute/path/to/repository --dry-run
```

どちらもOpenAI APIを呼ばず、キーも不要です。GitHub取得には`gh`の認証とネットワークを使います。`evidence.json`にソース全文、`coverage.md`に収集・除外パス、`request.json`に実際の21質問と入力を保存します。

`explanation-preflight-request.json`は、Solの入力容量確認用に全軸10点を仮置きしたリクエストです。**採点結果ではなく、理由生成にもそのまま送信しません。** 実際の点数が確定した後に`explanation-request.json`を作ります。

## 採点と理由生成

```bash
npm run judge -- --repo OWNER/REPO
# 点数だけ必要ならSolの呼び出しを省略
npm run judge -- --repo OWNER/REPO --scores-only
```

既定では次の順番でOpenAI APIを呼びます。**ソースをOpenAIへ送り、API利用料が発生します。** CodexのChatGPT利用枠ではありません。

1. `responses/input_tokens`でDecisions入力とSolの想定入力の容量を確認。
2. `decisions` / `gpt-6-luna`で21 predicateを評価。点数・20条件の真偽と確率・攻撃判定を保存。
3. 確定点で作ったSol入力をもう一度計数。
4. `responses` / `gpt-6.1-sol`、reasoning `medium`で理由生成。変更できるのは説明、既存パスの引用、追加の要確認フラグだけです。

`--scores-only`はDecisions用の計数とDecisions呼び出しのみです。リダイレクト・自動再試行・別モデルへの切替は行いません。タイムアウトは応答本文の受信まで含みます。

```bash
# 自分のPrivate repoを準備用に読む（公開状態は変更しない）
npm run judge -- --repo OWNER/PRIVATE-REPO --allow-private
# 保存した全文の同じ材料を再採点する
npm run judge -- --snapshot runs/PREVIOUS/evidence.json
# Solの理由だけ再実行。Decisionsを再採点せず、新しいrunへ保存する
node src/cli.mjs explain --from runs/PREVIOUS
```

理由生成が失敗してもDecisionsの点数は保存します。終了コードは非ゼロで、`failure.json`の`scored`が`true`、`result.json`の`explanationStatus`が`failed`になります。再実行は保存した証拠・質問・応答・点数・profileHashを照合し、変更があれば停止します。Privateの再実行にも`--allow-private`が必要です。

`--out runs/NAME`で新規保存先、`--timeout 240`で1 API呼び出しの待ち時間を指定できます。既存runは上書きしません。`--help`でオプションを確認できます。

## 点数の読み方

基準は[公開実装の4カテゴリー・20条件](docs/published-rubric.md)に日本語で記載しています。technical（新機能の活用）、ux（使いやすさ）、impact（有用性）、idea（独創性）の4軸は独立です。

例えば2・4・6・8・10点条件の確率が `[0.99, 0.94, 0.79, 0.96, 0.91]` なら**4点**です。6点条件が未達なので、8点・10点には進みません。下位条件が未達なのに上位が成立する矛盾は `reviewRequired: true` として残します。0.8という閾値は、精度80%・通過確率80%という意味ではありません。

新機能の適格性は主催者コード内の時点付き参照情報に従い、technicalの5質問だけへ渡します。対象コードを実行せず、リンク先・デモ・画像を見ず、ソースから判断します。攻撃確率は点数と独立し、合計へ加減しません。

実装ファイルの有無による`eligible` / `no_implementation`も別判定です。公開状態以外の参加ルール（制作ツール・Web稼働・過去の提出歴など）は人の確認を要する`unknown`のままです。リポジトリ上の自己申告だけで全参加条件を満たすとは判定しません。

## 収集範囲と限界

- デフォルトブランチのSHAまたはローカルHEADを固定。ローカルの未コミット変更・未追跡ファイルは含めません。
- 標準名のテスト、依存物、生成物、lockfile、既知の素材・バイナリ・秘密情報用パスを取得前に除外します。主催者が確認したアセットの除外はrepo＋SHA＋完全一致パスに限定します。
- インラインテストなどは製品ファイル内に残りますが、モデルへ根拠に使わないよう指示します。全テスト・秘密文字列を自動検出する仕組みではありません。
- 通常の製品例・HTML内のSVG・シェーダー・未知拡張子のUTF-8などは残します。対象の全文が容量を超える、Git treeが不完全、blob取得に失敗する場合は採点を停止します。
- 同じ本文はモデル入力内で`sameContentAs`参照にまとめますが、保存済み原文と各パスは保持します。
- 旧formatVersion 1の部分スナップショットは全文として再利用しません。`published-v4`で使う場合は収集し直してください。

公開版のGit pack通信・Cloudflare Queue/DB・再採点管理・順位発表は移植していません。ローカル版はGitHub REST/rawとGitを使い、ネットワーク制限も本番と異なります。実装・プロンプト・入力を固定しても過去のモデル応答の一致までは保証できません。上流の説明プロンプトに残るテスト根拠の矛盾も[実装差分](docs/published-judge.md)に明記しています。

## 出力

`runs/日時-対象/`はGit管理対象外。フォルダは所有者のみアクセス可、ファイルは所有者のみ読み書き可にします。

| ファイル | 内容 |
|---|---|
| `evidence.json` / `coverage.md` | 全文・固定SHA・sourceHash・件数・容量・収集範囲 |
| `profile.json` / `event-rules.json` | 条件・送信質問・参照版・実装ハッシュ / 提供された参加ルール |
| `request.json` / `response.json` | Decisionsの送信本文 / 検証済み応答。認証ヘッダーは保存しない |
| `preflight.json` | 各段階の実入力計数と安全上限 |
| `decisions-result.json` | 理由生成前の不変な確定点 |
| `explanation-preflight-request.json` | 容量確認用の仮置き入力。採点結果ではない |
| `explanation-request.json` / `explanation.json` | 確定点を渡す理由用入力 / 検証済み理由 |
| `result.json` / `report.md` | v4結果、実行情報、点数・条件・理由・要確認 |
| `failure.json` | 失敗段階と点数が確定済みかどうか |

## 従来方式を使う場合

```bash
npm run judge -- --repo OWNER/REPO --profile legacy-44
npm run judge -- --snapshot runs/OLD/evidence.json --profile legacy-44
```

[config/rubric.json](config/rubric.json)を正本とする[44段階の独自基準](docs/scoring-rubric.md)を維持しています。旧v3結果は小数の期待値であり、公開版の偶数段階点とは直接比較できません。legacy-44の出力には旧来の分布・関連ファイル候補・正規表現nuko-scoreが含まれます。

## 検証

```bash
npm run rubric
npm run check
npm test
npm run smoke -- --dry-run
```

自動検証は架空のソースとモックAPIを使います。`npm run smoke`を`--dry-run`なしで実行すると、`.env`の実キーで課金のある採点と理由生成を行います。今回の実装検証では実APIを呼んでいません。

## 出典と保存した参照

- [今回の公開審査コードと実装差分](docs/published-judge.md)
- [公開コードの段階条件](docs/published-rubric.md) / [検証範囲](docs/validation.md)
- [10/18提供ルール本文](reference/event-rules-2026-10-18.md) / [参加条件](docs/event-rules.md)
- [前回7月版の分析](docs/upstream-analysis.md) / [FAQ記録](docs/faq-notes.md)
- [前回版の不変スナップショット](reference/upstream/PROVENANCE.json)
- [今回公開版の不変スナップショット](reference/published-20261018/PROVENANCE.json)
- [MITライセンス・権利表記](THIRD_PARTY_NOTICES.md)

提供ルール本文は当時の記録として保持し、この変更で開催ページを再取得したとは扱いません。今回追加した実装の事実は、上記の公開コードと履歴を出典に分けています。
