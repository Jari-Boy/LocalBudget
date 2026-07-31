# 意思決定ログ

このドキュメントは、実装を進める中で生じた設計判断を時系列で記録するものである。
`docs/architecture.md` が定めた大枠の方針（ADR）に対し、実装フェーズで生じた個別の技術選定・設計判断を追記していく。

`doc-updater` エージェントが `/pr`・`/after-pr`・`/update-docs` 実行時に、以下のいずれかに該当する変更があれば追記する。

- 新しいアーキテクチャパターンを導入した
- 既存の設計方針を変更した
- 技術選定（ライブラリ・フレームワーク）をした
- インフラ構成・永続化方式を変更した

## フォーマット

```
## YYYY-MM-DD: <決定内容の要約>

**背景**: なぜこの判断が必要になったか
**決定**: 何を決めたか
**影響**: 既存コード・今後の実装への影響
```

---

## 2026-07-31: マイグレーションのDDLはdocs/schema/*.sqlを`?raw`インポートで直接参照する

**背景**: `src/infrastructure/db/migrations.ts`（Issue #5、初回のマイグレーションランナー実装）でスキーマ定義をどう供給するか検討した際、TypeScript側にDDL文字列を転記・再定義する案もあった。しかし本リポジトリでは過去に`docs/schema/*.sql`とドメインドキュメント間でDDLが乖離した実績があり（コミット8761c58「Fix DDL drift from domain docs and FK reference gaps」）、さらに今回のIssue #5実装中にも、`docs/domain/accounts.md`に明記されたドメインルール（`is_system_managed`科目のライフサイクル制約）が当初の`docs/schema/accounts.sql`のDDLに反映されていないという類似の実装漏れがevaluatorのレビューで発覚した（詳細は`docs/guides/patterns.md`参照）。DDLの記述先が複数箇所に分散するとこの種の乖離が繰り返し起こりうることが具体的に確認された。
**決定**: `docs/schema/*.sql`をコピーせず、Viteの`?raw`インポート機能で`migrations.ts`から直接文字列として読み込む方式を採用した。`docs/schema/`配下のSQLファイルがDDLの唯一の情報源（single source of truth）となり、実装側とドキュメント側でDDLの内容が二重管理・乖離することが構造的に起こらなくなる。
**影響**: 今後スキーマを変更する際は`docs/schema/*.sql`を直接編集すればよく、`src/`側に別途DDLを転記・同期する作業は不要。一方でテーブル間の相互参照があるため、マイグレーション適用順序（`migrations.ts`の`MIGRATIONS`配列に並べる順）は各ファイルの依存関係を踏まえて手動管理する必要がある（`migrations.ts`のコメント参照）。

**検討したが採用しなかった判断**:
- 「システム管理科目（`is_system_managed`）の削除・非アクティブ化・name以外の変更を禁止する制約をDDLトリガーで強制する」（コミット5f809e4）は、実装フェーズでの技術選定というより、既存の`prevent_category_change`・`prevent_delete_account_with_references`トリガーと同じ確立済みパターンをもう一つの制約に横展開したものであり、新しい設計判断ではないため記録しない。「DDLトリガーで強制するか／Repository層でガードするか」の判断基準自体は`docs/domain/accounts.md` 3.3（循環参照防止の例）に既に記録されている。
- 「`docs/schema/`配下9ファイル全部を初回マイグレーションで一括適用する」は、実装時に生じた判断ではなくIssue #5本文で計画段階から確定していた前提であるため、実装フェーズの決定として記録しない。

## 2026-07-31: AccountRepositoryをドメイン層（型定義・インターフェース）とインフラ層（sql.js実装）に分離する

**背景**: `docs/architecture.md` 10章のテスト戦略は元々「ドメインロジックは純粋なTypeScript関数としてユニットテスト」「DBアクセス層（Repository実装）は統合テスト」という2層分離を意図していた。しかしIssue #5で実装した`AccountRepository`（`src/infrastructure/db/AccountRepository.ts`）はこれを踏襲せず、`Account`等の型定義・Repositoryインターフェースに相当する形状・sql.jsによるSQL実装が同一ファイル（インフラ層）に同居していた。次に着手する仕訳（JournalEntry）ドメインでは貸借バランス検証というDBアクセスを伴わない純粋なドメインロジックが発生する見込みであり、これをインフラ層のファイルに置くと10章のテスト戦略上ユニットテストとして分離できない。
**決定**: `src/domain/account/Account.ts`（型定義）・`src/domain/account/AccountRepository.ts`（Repositoryインターフェース、ポート）をドメイン層に新設し、`src/infrastructure/db/AccountRepository.ts`は`SqlJsAccountRepository.ts`にリネームした上で、クラス名を`SqlJsAccountRepository`に変更してドメイン層のインターフェースを`implements`する形に改めた（振る舞い・DDL制約への依存は変更なし）。詳細は`docs/architecture.md` 5.1節に反映した。
**影響**: 既存の`AccountRepository`利用箇所（テストコード含む）はインポート元とクラス名の変更が必要（`src/infrastructure/db/SqlJsAccountRepository.test.ts`で対応済み）。今後実装する仕訳（JournalEntry）等の他ドメインも、新規実装の時点から`src/domain/<集約名>/`（型定義・Repositoryインターフェース・純粋なドメインロジック）と`src/infrastructure/db/`（`SqlJs<集約名>Repository`実装）の分離構成に従う規約とする。
