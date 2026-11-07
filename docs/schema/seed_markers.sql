-- seed_markers: 起動時の初期データ投入(seed)を「そのDBで一度だけ判定した」ことの印(計画Issue #154)
--
-- 利用者が削除・改名できる初期データ(標準グループなど)は、「0件なら投入する」だけの判定だと、
-- 利用者が全部消した後の再起動で復活してしまう。投入の判定をしたら印を残し、2回目以降は
-- 何も投入しない。
--
-- この表はマイグレーション(runMigrations)では作らない。既存のDBは`PRAGMA user_version`が
-- 最新のためマイグレーションが再実行されず、差分マイグレーションの仕組みは未整備のため、
-- 投入処理(seedStandardAccountGroups)が`CREATE TABLE IF NOT EXISTS`で冪等に作る。
-- バックアップ復元の必須テーブル(assertValidDatabaseSchema)にも含めない(印の無い旧バックアップを
-- 拒否しないため)。

CREATE TABLE IF NOT EXISTS seed_markers (
  name       TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
