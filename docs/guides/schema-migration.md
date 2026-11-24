# スキーマ変更ガイド(差分マイグレーション・凍結・リリース手順)

本番運用後に、利用者のDB(ブラウザのIndexedDB、または同期フォルダのファイル)をデータを失わずに新しいスキーマへ移すための手順書である。
設計の判断は `docs/decisions.md` の 2026-11-15「本番運用後のスキーマ変更は…」(計画Issue #42)、起動シーケンスは `docs/architecture.md` 5章、バックアップの扱いは同8章を参照する。

## 1. 仕組みの全体像

- **最新スキーマ**: `docs/schema/*.sql` が唯一の情報源(2026-07-31のADR)。新規DBはこれをそのまま流し、`PRAGMA user_version` を最新(`LATEST_SCHEMA_VERSION`)にする。
- **差分**: 既存DBは `src/infrastructure/db/migrations.ts` の `SCHEMA_PLAN.diffs`(キーは移行先のバージョン)を、現在の `user_version` の次から順に、**1つのトランザクションで**流す。差分は SQL 文字列でも TypeScript 関数 `(db) => void` でも書ける(データ変換が要るとき)。
- **失敗時**: 差分が途中で失敗するとロールバックされ、DBは変更されない。起動は止まり、エラー画面から元のDBを書き出せる。差分を流す前に、元のDBが保存先ごとのバックアップ(IndexedDBは別キー `pre-migration-backup`、フォルダ保存は同じフォルダの `local-budget.pre-migration-backup.sqlite`。どちらも直近の1つだけ)に自動保存され、成功後は直ちに保存される。
- **新しいバージョンのDB**: `user_version` が `LATEST_SCHEMA_VERSION` より大きいDB(新しいアプリで保存されたもの)は、開かずに案内画面を出す(アプリの更新・データの書き出し)。アプリより新しいバックアップの読み込みも拒否する。

## 2. 本番前(凍結前)の運用

本番運用が始まるまでは、これまでどおり **DDLを直接修正してよい**(`docs/schema/*.sql` を編集し、差分は足さない。開発用DBは作り直す)。固定データ(フィクスチャ)が1件も無いので、差分の書き忘れを検出するテストは実際のスキーマには効かない。

> 補足: 計画Issue #42の時点では、本番前の `LATEST_SCHEMA_VERSION` は 1、差分は0件だった。その後、計画Issue #223(`accounts.system_role` の追加)で、既存DBが起動できなくなるのを避けるため、スキーマv2の差分(`src/infrastructure/db/migrationV2SystemRole.ts`、`LATEST_SCHEMA_VERSION` = 2)を足した。その後、表の形を変えないデータ変換として、v3(`migrationV3NormalizeKeywords.ts`。`keyword_rules.pattern`を照合用の正規化に揃える)とv4(`migrationV4NormalizeDescriptions.ts`。取り込み済みの仕訳の摘要`journal_entries.memo`を表示用の標準化に変換し、キーワードをハイフンの標準化を加えた規則で再正規化する)を足した(`LATEST_SCHEMA_VERSION` = 4。2026-11-18、計画Issueなし・不具合対応。決定は`docs/decisions.md`の同日の項)。その後、計画Issue #231 フェーズ3で、明細取込の一時保存の表(`statement_import_drafts`・`statement_import_draft_files`)を足すv5(`migrationV5StatementImportDrafts.ts`、`LATEST_SCHEMA_VERSION` = 5。2026-11-19)を、続けて、計画Issue #231 フェーズ4で、科目・取引先・プロジェクトのお気に入りの列(`is_favorite`)の追加とシステム管理科目のトリガーの更新を行うv6(`migrationV6Favorites.ts`、`LATEST_SCHEMA_VERSION` = 6。2026-11-19)を足した。続けて、計画Issue #236で、表の形を変えないデータ変換のv7(`migrationV7NormalizeKanaKeywords.ts`、`LATEST_SCHEMA_VERSION` = 7。2026-11-21)を足した。`keyword_rules.pattern`を、ひらがな・小書き文字を統一した規則で正規化し直す(重なりのまとめ方はv3・v4と同じ)。続けて、計画Issue #271で、割勘仕訳が元のどの明細行を割ったかを持つ表`expense_split_source_lines`と、記録がある行の金額・貸借の変更を拒否するトリガー`prevent_change_on_expense_split_source_line`を足すv8(`migrationV8ExpenseSplitSourceLines.ts`、`LATEST_SCHEMA_VERSION` = 8。2026-11-23)を足した。データの変換はせず、既存の割勘仕訳は記録を持たないまま仕訳単位の割勘済みとして扱う。続けて、計画Issue #249で、精算バッチのクローズ(`settlement_batches.is_active`、既存は有効)と、クローズ時の振替仕訳の記録の表`settlement_batch_close_entries`を足すv9(`migrationV9SettlementBatchClose.ts`、`LATEST_SCHEMA_VERSION` = 9。2026-11-23)を足した。データの変換はしない。したがって現在は、差分が8件(v1→v2→v3→v4→v5→v6→v7→v8→v9)あり、DDLの直接修正だけでは済まない変更があった実績がある。差分は凍結されたバージョンの記録なので、v3・v4は表示・照合用の関数を呼ばず、その時点の規則を差分の中に写して持つ(後で規則が変わっても、過去の差分の結果が変わらないように)。凍結は「その時点の最新バージョン」を凍結する汎用の作りなので、凍結の際は、どのバージョンで凍結するか(v2〜v9の差分を残すか、1に戻すか)を、その時点で決めて確かめる。凍結の実施有無はこの文書では扱わない。

## 3. 凍結(初回の本番デプロイの直前に、手作業で行う)

デプロイの仕組みが無いため、凍結は手作業とする。**初回の本番デプロイの直前に、次の手順を必ず行う**(忘れると、以後の差分の書き忘れをCIが検出できない)。

1. `main` が最新で、`npx vitest run` が通ることと、`LATEST_SCHEMA_VERSION` が凍結するバージョンであることを確認する(v2〜v11の差分を足したため、現在は11。1から始めたい場合は、v2〜v11の差分の扱いを先に決める)。
2. `npm run schema:freeze` を実行する。`src/infrastructure/db/schemaFixtures/v{N}.sql`(N = `LATEST_SCHEMA_VERSION`。スキーマと、起動時の初期投入データ)が作られる。凍結済みのバージョンのファイルは上書きしない(公開済みスキーマの記録は不変)。
3. 生成された `v{N}.sql` を確認してコミットする。
4. 次の「凍結時の後片付け」を行う。
5. 本番へデプロイする。

### 凍結時の後片付け

- 計画Issue #219で足した、旧`counterparty_patterns`表を`keyword_rules`へ変換する暫定処理(起動時・`assertImportableDatabase`)と、そのテストを取り除き、凍結後に必要な変換は差分で行う。
- `src/infrastructure/backup/assertValidDatabaseSchema.ts` の、`journal_lines.household_member_id` がNOT NULLでない旧スキーマのバックアップを拒否する検査(計画Issue #169)と、そのテストを外す。凍結後は、旧バージョンのバックアップも差分で読み込めるのが原則である。
- 起動時の初期投入(seed)が `CREATE TABLE` をしていないかを確認する。現状は `seedStandardAccountGroups` が `seed_markers` を `CREATE TABLE IF NOT EXISTS` で作っている(凍結前の開発用DBのため)。この `db.run(seedMarkersSql)` を取り除き、以後の表の追加は差分で行う。

### 凍結後のCI

`src/infrastructure/db/schemaFixtures.test.ts` が、各フィクスチャに差分を流した結果と、最新スキーマから新規作成した結果を、テーブル・列・外部キー・CHECK制約・インデックス・トリガー・ビューの定義で比べる(`findSchemaDifferences`。空白・改行・コメントの書式差と列の並びは無視する)。**DDLを変えたのに差分を書き忘れると、このテストが落ちる**。

## 4. スキーマを変えるとき(凍結後)

1. `docs/schema/*.sql`(最新)を修正する。
2. `LATEST_SCHEMA_VERSION` を1上げる。
3. `SCHEMA_PLAN.diffs` に、そのバージョンへの差分を足す。
4. `schemaFixtures.test.ts` が通ることを確認する(差分で最新に追いつかないと落ちる)。データ変換を伴う差分は、変換の結果を確かめるテストを `migrations` 側に別途書く。
5. 新しい表を足した場合も、`assertValidDatabaseSchema` の必須テーブルには**加えない**(旧バックアップの取込を止めないため)。

### 4.1 列の追加・インデックス・トリガーの追加

`ALTER TABLE ... ADD COLUMN` / `CREATE INDEX` / `CREATE TRIGGER` / `CREATE TABLE` をそのまま差分に書けばよい。NOT NULL の列を足すときは既定値を付ける(SQLiteの制約)。

### 4.2 列の型・CHECK制約・NOT NULL・外部キーの変更(テーブルの作り直し)

SQLiteは、これらを `ALTER TABLE` で変えられない。**テーブルを作り直す**。`runMigrations` は外部キー検査(`PRAGMA foreign_keys`)をトランザクションの外で止めてから差分を流すので、差分の中では次の順に書く。

1. `CREATE TABLE <名前>_new (...)` — 新しい定義で作る
2. `INSERT INTO <名前>_new (...) SELECT ... FROM <名前>` — データを写す(必要ならここで変換する)
3. `DROP TABLE <名前>`
4. `ALTER TABLE <名前>_new RENAME TO <名前>`
5. 元のテーブルに付いていた**インデックス・トリガーを作り直す**(`DROP TABLE` で消えるため)。ビューや、そのテーブルを参照する他のトリガーも確認する
6. 外部キーの検査は `runMigrations` が最後に `PRAGMA foreign_key_check` で行い、違反が残れば全体をロールバックする(差分の中で呼ぶ必要はない)

参考: SQLite公式「ALTER TABLE」の「Making Other Kinds Of Table Schema Changes」。

### 4.3 データ変換

データ変換は**差分(マイグレーション)側**で行う。起動時の初期投入(seed)は冪等(何度流しても同じ結果)なままにし、既存データの書き換えには使わない。

記録(表の形を変えないデータ変換): v3・v4・v7はキーワードと取込済みの摘要の標準化、v10(計画Issue #279)は`keyword_rules.pattern`を「かな+空白+分離した濁点・半濁点」を1文字にまとめる規則で再正規化(重なりのまとめ方はv3・v4・v7と同じ)、v11(同)は取込済み(`source_type = 'external_import'`)の`journal_entries.memo`の同じ形を整える。突合用の`external_transaction_refs.description`と`external_id`は変えない。規則は凍結された差分の中に写して持つ。

## 5. 補足

- 凍結の仕組みは、デプロイのワークフローが無い間の手作業である。デプロイの仕組みを作るときに、凍結をそこへ組み込むかを検討する。
- 自動バックアップのファイル(`local-budget.pre-migration-backup.sqlite`)は、同期フォルダでは同期クライアントの対象になる。
- 古いUIがすでにファイルを開いている状態で別の端末が更新した場合は、外部変更の検知(計画Issue #175)が上書きを防ぐ。
