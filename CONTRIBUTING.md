# コントリビューションガイド

## 開発環境のセットアップ

```bash
npm install
npm run dev
```

## 開発時によく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run lint` | oxlintによる静的解析 |
| `npm run typecheck` | tscによる型チェック |
| `npm test` | Vitestによるユニット/統合テスト |
| `npm run test:e2e` | Playwrightによるe2eテスト(dev server) |
| `npm run test:e2e:pwa` | Playwrightによるe2eテスト(本番ビルド、Service Worker関連) |

## 依存関係の管理方針

`docs/architecture.md` 11章の通り、本アプリはサーバーを持たずクライアントのみで完結するため、悪意あるnpm依存関係がユーザーの家計データを外部に送信できてしまうサプライチェーンリスクが相対的に主要な脅威となる。依存関係は以下の方針で管理する。

### lockfileの固定

- `package-lock.json`は必ずコミットする。
- インストールには`npm ci`を使う(`package-lock.json`の内容を厳密に反映し、意図しないバージョン変更を防ぐ)。`npm install`は新しい依存関係の追加・更新など、`package-lock.json`自体を変更する操作でのみ使う。

### 依存追加・更新時のレビュー

新しい依存関係の追加、または既存の依存関係の更新をレビューする際は、以下を確認する。

- 本当に必要か(既存の依存関係や標準APIで代替できないか)
- メンテナンス状況(直近のリリース時期、Issue/PRへの対応状況)
- ダウンロード数・採用実績
- 既知の脆弱性がないか(`npm audit`)
- ライセンス(商用利用・改変に問題がないか)
- インストール時に任意コードを実行する仕組み(`postinstall`スクリプト等)を持たないか

### npm auditの自動実行

- PR作成時・`main`へのpush時にCI(`.github/workflows/ci.yml`)で`npm audit --audit-level=high`を実行し、高深刻度以上の脆弱性を検出する。依存関係を追加・更新するPRでも自動的にチェックされる。
- 依存関係に変更がない期間も新たに公開された脆弱性を検出できるよう、`.github/workflows/scheduled-audit.yml`で毎週月曜(0:00 UTC)にスケジュール実行する。
- 脆弱性が検出された場合は`npm audit fix`または該当パッケージの手動更新で対応する。上流パッケージ側の対応待ちなどですぐに解消できない場合は、`package.json`の`overrides`で影響を受ける依存関係のバージョンを個別に固定する(既存の`sharp`に対する`overrides`参照)。
