# DevDay 2026 Prejudge

**10月18日のDevDay Community Hackathon Tokyoに向けた、非公式の事前採点ツールです。**
公開済みの過去審査コードを分析し、今回の確定ルールに合わせて、GitHubリポジトリだけをCodex CLI経由のモデルへ渡して採点します。既定モデルはGPT-6.1 Solです。

**2026-10-18に提供された確定ルールの4観点へ更新済みです。** 公式の配点・重みは示されていないため、各0〜10点・等配点・合計40点は本ツールの仮の目安です。本番点数・順位・通過確率ではありません。参加ルールの確認は点数と別に行います。

| 公式の観点 | 評価すること | 本ツールの仮配点 |
|---|---|---:|
| 新機能の活用 | DevDay 2026発表の機能が、目的に合う形で使われているか | 10 |
| 使いやすさ | 他の人にとって使いやすいか | 10 |
| 有用性 | 他の人にとって今後役に立つ可能性があるか | 10 |
| 独創性 | 着眼点や解決方法にオリジナリティがあるか | 10 |

新機能の利用は点数に含みます。機能名だけでなく、目的・実装・入出力との対応を評価します。前回コードの「技術的な実装」という独立項目は廃止し、技術上の根拠は該当する4観点へ反映します。

## まず読む

- [前回コードのロジック・要点](docs/upstream-analysis.md)
- [今回のルールと未確認事項](docs/event-rules.md)
- [更新に使った確定ルールの提供本文](reference/event-rules-2026-10-18.md)
- [指定されたFAQスレッド19件の要約](docs/faq-notes.md)
- [提出READMEの下書きテンプレート](templates/SUBMISSION_README.md)
- [検証済み範囲](docs/validation.md)

## 使い方

Node.js 22以上、Git、GitHub CLI `gh`、Codex CLIが必要です。npm依存パッケージはありません。Codex CLI 0.155.1で検証しています。

```bash
git clone git@github.com:kolife01/devday-2026-prejudge.git
cd devday-2026-prejudge
gh auth status
codex login status
```

まずモデルを呼ばず、実際に選ばれる評価材料を確認します。

```bash
npm run snapshot -- --repo OWNER/REPO
```

採点して日本語レポートを生成します。既存のCodexログインと利用枠を使います。

```bash
npm run judge -- --repo OWNER/REPO
```

公開前の自分のリポジトリも準備用として読めます。公開状態の変更は行いません。

```bash
npm run judge -- --repo OWNER/PRIVATE-REPO --allow-private
```

ローカルでは、コミット済みHEADだけを読みます。未コミット変更や未追跡ファイルは含みません。

```bash
npm run judge -- --local /absolute/path/to/candidate-repository
```

保存した同じ材料で再評価する場合:

```bash
npm run judge -- --snapshot runs/PREVIOUS-RUN/evidence.json --model gpt-6.1-sol --effort medium
```

`--out runs/NAME`で保存先、`--timeout 240`で採点待ち時間を指定できます。既存フォルダは上書きしません。`--help`で全オプションを確認できます。

### GPT-6.1が利用できないとき

2026-10-17のこのMacのCodexログインでは、`gpt-6.1-sol`指定がサーバーから未対応として拒否されました。ツールは失敗を記録して停止し、モデルを勝手に変えません。利用可能なモデルで参考採点をする場合は明示してください。モデルが違う点はレポートにも残ります。

```bash
npm run judge -- --repo OWNER/REPO --model gpt-6-sol
```

GPT-6.1系を使える環境では既定コマンドのまま実行できます。`snapshot`だけならモデル接続は不要です。出力された`prompt.md`をGPT-6.1が利用できるCodexへ渡して検討することもできますが、その手作業の回答はCLIの検証済み結果とは区別してください。

## 出力

`runs/<日時>-<対象>/`に保存します。このディレクトリはGit管理対象外です。

| ファイル | 内容 |
|---|---|
| `report.md` | 4項目の点数、根拠、不足、ルール確認、修正優先順 |
| `result.json` | 検証済みの構造化結果、SHA、モデル指定、利用トークン等 |
| `coverage.md` | 読まれた/読まれなかったファイル、切り詰め、未コミット差分の注意 |
| `evidence.json` | 採点に渡したテキストとSHA256ハッシュ |
| `prompt.md` | 実際に渡した入力。対象コードを含むため共有範囲に注意 |
| `rubric.json` | その回の公式4観点、仮の配点、独自の評価指針 |
| `event-rules.json` | その回に適用したルール、基準日、各項目の根拠 |
| `nuko-score.json` | 前回コードのインジェクション兆候スコア。40点には加減しない |
| `failure.json` | 失敗時のみ。失敗を採点成功や0点扱いにしない |

## 採点の前提

1. GitHubのデフォルトブランチのSHA、またはローカルHEADを固定します。
2. 過去コードと同じ優先順位で最大24ファイルを選び、同じ文字切り詰め処理をします。
3. Codexへテキストを直接渡します。候補リポジトリのコード・テスト・ビルドは実行しません。
4. Codexのユーザー設定・プラグイン・シェル・Web検索・メモリ等を無効にした一時セッションで1回採点します。
5. 点数合計、項目重複、根拠ファイル、ルール状態を検証してからレポートを出します。

Private入力は `--allow-private` が必要です。ローカル入力のGitHub公開状態は確認できないためunknownになります。ファイル名による秘密情報除外は網羅的ではありません。モデルへ渡す内容は`coverage.md`と`evidence.json`で確認できます。

## 本番との違い

- 4観点は確定しています。**公式の配点・重み、詳細な採点プロンプト、effort、ファイル収集方式は未確認**です。評価指針と0〜10点のアンカーは本ツール独自のものです。
- 本番予選は**GPT-6.1 SolあるいはDecisions APIを予定**。本ツールはCodex CLI経由のみで、Decisions APIによる評価は実装していません。本戦の審査方法も未決定です。
- DevDay新機能の目的に合った活用を1つの正式な観点として採点し、4観点以外のボーナスは加えません。
- 取得した証拠の不足と、作品に実装が存在しないことを区別します。
- 当日の参加条件や制作手段はコードだけでは証明できず、人による確認が残ります。
- GitHub収集時のMIME判定は上流同様、ローカル/Privateはテキスト判定を近似します。
- 上流より追加で、典型的な秘密ファイル名、symlink、NULを含むbinaryを除外します。
- 審査サーバー、公開ランキング、Cloudflareへのデプロイはありません。ローカル実行のみです。

ハッカソン中の開発に使えるのは**Codex CLI / Codex App / ChatGPT Work**です。Claude Code、CursorやDevin経由のOpenAIモデル、OpenAI OAuthを使うサードパーティのハーネスは禁止されています。事前準備は未公開の新規プロトタイプまでで、他ハッカソンの提出作品の改修は不可です。DevDay関連情報の事前調査は推奨されています。

本ツールは事前の証拠収集・参考採点用で、作品の生成・修正ループを持ちません。この設計が当日の使用許可を意味するわけではなく、利用範囲は主催者の案内を優先してください。提出作品でChatGPT SignInを利用できるというFAQ回答も、開発用ハーネスの許可とは別です。

今回のルール更新はユーザー提供本文に基づきます。開催ページを今回再取得したものではありません。旧バージョンの点数とは観点が異なるため直接比較せず、必要なら保存済み`evidence.json`で再採点してください。出力の`rubricId`と`rulesAsOf`に適用版を記録します。

## 検証

```bash
npm run check
npm test
```

実モデルの疎通テストは架空サンプルを採点します。Codex利用枠を消費します。

```bash
npm run smoke
```

## 出典

- [2026-10-18に提供された確定ルール本文](reference/event-rules-2026-10-18.md)
- [前回の公開審査実装](https://github.com/schroneko/automated-hachathon-judge/tree/f5c843ddad7aea1c68023e145ca9c0be0b575093)
- [今回の開催要項](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo)
- [予選はリポジトリのみというFAQ](https://x.com/hawkymisc/status/2111406160054231526)
- [FAQスレッドの起点](https://x.com/hawkymisc/status/2111399174914928930)
- [公式Codexコマンド仕様](https://learn.chatgpt.com/docs/developer-commands#codex-exec)
- [公式モデル情報](https://learn.chatgpt.com/docs/models#gpt-6.1-sol)

上流のソース・テスト・主要資料40ファイルを[reference/upstream](reference/upstream)に改変せず保存しています。固定SHAと各ファイルのSHA256は[PROVENANCE.json](reference/upstream/PROVENANCE.json)。第三者コードの権利表記は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
