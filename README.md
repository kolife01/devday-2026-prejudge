# DevDay 2026 Prejudge

**10月18日のDevDay Community Hackathon Tokyoに向けた、非公式の事前採点ツールです。**
公開済みの過去審査コードを分析し、今回のFAQに合わせて、GitHubリポジトリだけをGPT-6.1 Solへ渡して採点します。

本番の採点基準はFAQ時点では未決定です。ここでの **4項目・40点は過去コードに基づく仮の目安** であり、本番点数・順位・通過確率ではありません。今回確認できた参加ルールは、点数と別に判定します。

## まず読む

- [前回コードのロジック・要点](docs/upstream-analysis.md)
- [今回のルールと未確認事項](docs/event-rules.md)
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
| `rubric.json` | その回の仮採点基準 |
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

- 今回の**正確な採点基準、配点、モデルのvariant/effort、ファイル収集方式は未確定/未確認**。過去コードの複製による本番完全再現ではありません。
- 4項目は前回を踏襲。DevDay関連機能には未発表のボーナスを勝手に加えません。
- 取得した証拠の不足と、作品に実装が存在しないことを区別します。
- 当日の参加条件や制作手段はコードだけでは証明できず、人による確認が残ります。
- GitHub収集時のMIME判定は上流同様、ローカル/Privateはテキスト判定を近似します。
- 上流より追加で、典型的な秘密ファイル名、symlink、NULを含むbinaryを除外します。
- 審査サーバー、公開ランキング、Cloudflareへのデプロイはありません。ローカル実行のみです。

FAQには自作ハーネスによる**提出作品の開発**は不可とあります。本ツールは証拠を採点するだけで、作品の生成・修正ループを持ちません。当日のツール利用範囲は主催者の案内を優先してください。

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

- [前回の公開審査実装](https://github.com/schroneko/automated-hachathon-judge/tree/f5c843ddad7aea1c68023e145ca9c0be0b575093)
- [今回の開催要項](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo)
- [予選はリポジトリのみというFAQ](https://x.com/hawkymisc/status/2111406160054231526)
- [FAQスレッドの起点](https://x.com/hawkymisc/status/2111399174914928930)
- [公式Codexコマンド仕様](https://learn.chatgpt.com/docs/developer-commands#codex-exec)
- [公式モデル情報](https://learn.chatgpt.com/docs/models#gpt-6.1-sol)

上流のソース・テスト・主要資料40ファイルを[reference/upstream](reference/upstream)に改変せず保存しています。固定SHAと各ファイルのSHA256は[PROVENANCE.json](reference/upstream/PROVENANCE.json)。第三者コードの権利表記は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
