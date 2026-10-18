# DevDay 2026 Prejudge

**GitHubリポジトリのテキストを、OpenAI Decisions APIで4カテゴリー・各0〜10点で評価する非公式の事前採点ツールです。**

「新機能の活用・使いやすさ・有用性・独創性」は、2026-10-18に提供されたハッカソンの公式4観点です。各点の定義・等配点・合計40点はこのツール独自の基準で、本番点数・順位・通過確率を再現するものではありません。参加ルールは点数と別に確認します。

| カテゴリー | 評価すること | 範囲 |
|---|---|---:|
| 新機能の活用 | DevDay 2026の発表機能を、目的に合った形で実装・活用しているか | 0〜10 |
| 使いやすさ | 初めて使う人が迷わず操作でき、結果を理解し、失敗から復帰できるか | 0〜10 |
| 有用性 | 誰のどの課題を改善し、今後も役立つ可能性を裏付けられるか | 0〜10 |
| 独創性 | 着眼点や解決方法の工夫が、作品固有の価値として実装されているか | 0〜10 |

**[全44段階の採点基準](docs/scoring-rubric.md)** に、カテゴリーごとの0点・1点・…・10点を明文化しています。[config/rubric.json](config/rubric.json)を正本に、説明資料とAPIの`score`質問を生成します。説明した基準と実際にモデルへ渡す基準が一致します。

## セットアップ

Node.js 22以上が必要です。GitHubからの収集にはGitHub CLI `gh`、ローカルHEADからの収集にはGitが必要です。npm依存パッケージやCodexへのログインは不要です。

```bash
git clone git@github.com:kolife01/devday-2026-prejudge.git
cd devday-2026-prejudge
cp .env.sample .env
```

初回コピー後、`.env`の`OPENAI_API_KEY=`の右側にOpenAI APIキーを記入します。`.env`と`.env.*`はGitから除外し、空欄の`.env.sample`だけを管理します。既存の`.env`がある場合はコピーせず、そのファイルを編集してください。

`judge`は**実行ディレクトリの`.env`を自動で読み込みます**。`source .env`は不要です。すでに同名の環境変数が設定されている場合は、その値を優先します。

キーは後から設定できます。`snapshot`、`judge --dry-run`、`npm test`はキー不要です。

## 使い方

### キーなしで評価材料と送信内容を確認

```bash
npm run snapshot -- --repo OWNER/REPO
# または
npm run judge -- --repo OWNER/REPO --dry-run
```

GitHubを読む場合は`gh auth status`で認証状態を確認してください。上記はOpenAI APIを呼びません。`coverage.md`に取得範囲、`evidence.json`に本文、`request.json`に実際の送信予定データと全質問を保存します。

### .envにキーを入れた後、採点

```bash
npm run judge -- --repo OWNER/REPO
```

`POST https://api.openai.com/v1/decisions`を1回呼びます。モデルは、2026-10-19に確認した[公式仕様](https://developers.openai.com/api/docs/guides/decisions)で対応する`gpt-6-luna`です。OpenAI APIの利用料が発生します。CodexのChatGPTログインや利用枠は使いません。

Privateの自分のリポジトリを準備用として読む場合:

```bash
npm run judge -- --repo OWNER/PRIVATE-REPO --allow-private
```

公開状態は変更しません。Privateの保存済みスナップショットにも`--allow-private`が必要です。

ローカルのコミット済みHEADを読む場合:

```bash
npm run judge -- --local /absolute/path/to/candidate-repository
```

未コミット変更・未追跡ファイルは含めません。対象のコード、テスト、ビルドは実行しません。

保存した同じ材料を新しい基準で再評価する場合:

```bash
npm run judge -- --snapshot runs/PREVIOUS-RUN/evidence.json
```

旧バージョンの`evidence.json`も利用できます。`request.json`はその時点の基準で再生成するので、過去runと比較するときは`rubricId`と`rubricHash`も確認してください。公開状態などのメタデータも保存時の情報を使い、再取得はしません。

`--out runs/NAME`で保存先、`--timeout 240`でAPI待ち時間を指定できます。既存フォルダは上書きしません。`--help`で全オプションを表示します。

### 点数とレポートの読み方

各カテゴリーに11段階の`levels`を渡し、Decisions APIの`score`を受け取ります。たとえば7点の確率が60%、8点が40%なら**7.4点**です。4カテゴリーの未丸め値を足して40点満点とし、Markdownのみ小数2桁で表示します。整数化やボーナス加点はしません。

1回のリクエストには、4つの採点質問、4つの関連ファイル選択、2つのルール確認とその関連ファイル選択、合計12質問を含めます。採点結果に依存した追加呼び出しは行いません。

レポートには次を表示します。

- 4項目の点数、confidence、0〜10の全段階の確率。
- 最も確率が高い段階の定義と、次段階に向けて確認する条件。
- モデルが別の`choice`質問で選んだ関連ファイル候補。
- 点数と独立したルール確認、証拠の範囲と未確認事項。

**Decisions APIは自由文の講評を返しません。** 段階の説明は設定済みの定義を転記したものです。「次段階の条件」を作品の欠陥と断定したり、選ばれたファイルを引用付きの採点理由として扱ったりしません。関連ファイルが特定できない場合はその旨を明示し、APIの点数を勝手に0へ置換しません。confidenceも通過確率や実測の正解率ではありません。

## 出力

`runs/<日時>-<対象>/`に保存します。Git管理対象外です。フォルダは所有者のみアクセス可能、生成ファイルは所有者のみ読み書き可能にします。

| ファイル | 内容 |
|---|---|
| `report.md` | 点数、段階の定義、確率、関連ファイル候補、ルール確認 |
| `result.json` | v3形式の結果、SHA、基準とリクエストのハッシュ、モデル、API使用量 |
| `response.json` | 検証済みのAPI応答フィールド。任意の追加フィールドやエラー本文は保存しない |
| `coverage.md` | 読んだ/読まなかったファイル、切り詰め、未コミット差分の注意 |
| `evidence.json` | 評価対象のテキスト、SHA、証拠ハッシュ |
| `request.json` | APIに送るJSON本文そのもの。キー・認証ヘッダーは含まない |
| `prompt.md` | 全質問・段階定義・inputの読みやすい表示 |
| `rubric.json` | その回の44段階の定義と共通方針 |
| `event-rules.json` | 適用ルール・基準日・出典 |
| `nuko-score.json` | 過去コード由来のインジェクション兆候値。40点には加減しない |
| `failure.json` | キー不足やAPI・検証失敗時のみ。失敗を採点成功や0点にしない |

`snapshot`と`--dry-run`では結果・応答・レポートを作りません。読めるテキストが0件の場合は材料だけ保存し、送信JSONも作りません。保存された本文には候補作品のソースが含まれます。

## 実装上の前提

- GitHubのデフォルトブランチのSHA、またはローカルHEADを固定します。
- 前回公開審査コードの優先順位・切り詰めを引き継ぎ、最大24ファイルを選びます。10月本番でも同じ収集方式を使うかは未確認です。
- リンク先、画像、動画、Git履歴は取得しません。評価対象のコードを実行する機能はありません。
- 4カテゴリーと11段階、APIの応答数・名前・型・値域・確率分布・加重平均を検証します。回答拒否や一部回答の欠落も採点失敗として扱います。
- APIタイムアウトは本文受信まで含みます。リダイレクト、再試行、モデルの自動切替は行いません。認証情報やAPIのエラー本文をログに出しません。
- 公開状態はスナップショットのメタデータから判定します。制作ツール、事前公開、過去の提出歴、人数は人が確認するため`unknown`です。
- Web公開・モノレポの判定は資料内の根拠に限ります。Webサイトの稼働確認は別途必要です。

## 以前のCodex CLI版からの変更

実行経路をDecisions APIへ置き換えました。`PREJUDGE_CODEX_BIN`、Codexログイン、`--effort`、旧モデル指定は使いません。現在は`--model gpt-6-luna`のみを受け付け、他モデルを指定すると送信前に停止します。

`result.json`は整数の点数と自由文の講評を持つv2から、小数の点数・分布・定義への対応を持つv3へ変更しました。旧結果を自動変換せず、保存済み`evidence.json`を再採点します。旧点数との厳密な比較や本番との一致は検証していません。

## ルール・調査資料

- [今回のルールと未確認事項](docs/event-rules.md)
- [提供された確定ルール本文](reference/event-rules-2026-10-18.md)
- [前回公開コードのロジックと要点](docs/upstream-analysis.md)
- [指定FAQスレッド19件の要約](docs/faq-notes.md)
- [提出READMEテンプレート](templates/SUBMISSION_README.md)
- [検証済み範囲](docs/validation.md)

本番予選は提供ルール上「GPT-6.1 SolあるいはDecisions APIを予定」で、採用方式・配点・モデル設定は未確認です。本ツールの設定が主催者のものと一致するとは主張しません。

ハッカソン中の開発手段は**Codex CLI / Codex App / ChatGPT Work**。Claude Code、Cursor/Devin経由のOpenAIモデル、OpenAI OAuthを使うサードパーティハーネスは禁止されています。事前準備は未公開の新規プロトタイプまでで、他ハッカソン提出作品の改修は不可。DevDay関連の下調べは推奨されています。

このツールは証拠収集と参考採点用で、作品の生成・修正ループを持ちません。当日の利用可否は主催者の案内を優先してください。イベントルールは2026-10-18のユーザー提供本文に基づき、この変更で開催ページを再取得したものではありません。

## 検証と基準の更新

```bash
npm run check
npm test
# config/rubric.jsonの定義を変えたら資料も再生成
npm run rubric
```

架空サンプルで送信前の確認をする場合:

```bash
npm run smoke -- --dry-run
```

`.env`設定後の実API疎通確認（課金あり）:

```bash
npm run smoke
```

## 出典

- [確定ルールの提供本文](reference/event-rules-2026-10-18.md)
- [OpenAI Decisionsガイド](https://developers.openai.com/api/docs/guides/decisions)
- [OpenAI Decisions APIリファレンス](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [前回の公開審査実装](https://github.com/schroneko/automated-hachathon-judge/tree/f5c843ddad7aea1c68023e145ca9c0be0b575093)
- [今回の開催要項](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo)
- [リポジトリのみの予選というFAQ](https://x.com/hawkymisc/status/2111406160054231526)

上流40ファイルは[reference/upstream](reference/upstream)に改変せず保存しています。固定SHA・各ファイルのハッシュは[PROVENANCE.json](reference/upstream/PROVENANCE.json)、権利表記は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
