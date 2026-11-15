-- seed_markers: 起動時の初期データ投入(seed)を「そのDBで一度だけ判定した」ことの印(計画Issue #154)
--
-- 利用者が削除・改名できる初期データ(標準グループなど)は、「0件なら投入する」だけの判定だと、
-- 利用者が全部消した後の再起動で復活してしまう。投入の判定をしたら印を残し、2回目以降は
-- 何も投入しない。
--
-- この表は最新スキーマ(runMigrationsの新規作成。計画Issue #42)に含める。あわせて、投入処理
-- (seedStandardAccountGroups)も`CREATE TABLE IF NOT EXISTS`で冪等に作る。後者は、この表が無い
-- 凍結前の開発用DBのため。初回の本番デプロイの凍結後は、表の追加は差分マイグレーションで行い、
-- 投入処理からはこの`CREATE TABLE`を取り除く(docs/guides/schema-migration.md)。
-- バックアップ復元の必須テーブル(assertValidDatabaseSchema)には含めない(印の無い旧バックアップを
-- 拒否しないため)。

CREATE TABLE IF NOT EXISTS seed_markers (
  name       TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
