-- projects のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/projects.md を参照

-- kindは持たない(計画Issue #133)。プロジェクトはイベント専用の集計軸であり、
-- 精算バッチの識別はsettlement_batches(docs/schema/settlement_batches.sql)が担う。
-- プロジェクトグループ(計画Issue #143)。勘定科目グループ(account_groups)と同じ仕様:
-- 入れ子可・単一所属・表示専用(集計ロジックには関与しない)。categoryは持たない
CREATE TABLE project_groups (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  parent_group_id   INTEGER REFERENCES project_groups(id),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_project_groups_parent ON project_groups(parent_group_id);

-- グループ名は同じ親グループ内でユニーク(非アクティブは除外)。最上位はCOALESCEで0に束ねる
CREATE UNIQUE INDEX idx_project_groups_unique_name
ON project_groups(COALESCE(parent_group_id, 0), name)
WHERE is_active = TRUE;

-- 子グループを持つグループの物理削除を禁止
CREATE TRIGGER prevent_delete_project_group_with_children
BEFORE DELETE ON project_groups
WHEN EXISTS (SELECT 1 FROM project_groups WHERE parent_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete project group with child groups');
END;

-- updated_at の自動更新
CREATE TRIGGER project_groups_set_updated_at
AFTER UPDATE ON project_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE project_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- project_group_id = NULL は未分類
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  project_group_id INTEGER REFERENCES project_groups(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_group ON projects(project_group_id);

-- プロジェクトが所属するグループの物理削除を禁止
CREATE TRIGGER prevent_delete_project_group_with_projects
BEFORE DELETE ON project_groups
WHEN EXISTS (SELECT 1 FROM projects WHERE project_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete project group with projects');
END;

-- 仕訳明細が紐づくプロジェクトの物理削除を禁止
CREATE TRIGGER prevent_delete_project_with_journal_lines
BEFORE DELETE ON projects
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE project_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete project with journal lines');
END;

-- updated_at の自動更新
CREATE TRIGGER projects_set_updated_at
AFTER UPDATE ON projects
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id;
END;
