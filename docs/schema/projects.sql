-- projects のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/projects.md を参照

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'event'
    CHECK (kind IN ('settlement', 'event')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

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
