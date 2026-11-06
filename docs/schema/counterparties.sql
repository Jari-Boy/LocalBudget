-- counterparties / counterparty_patterns のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/counterparties.md を参照

-- 取引先グループ(計画Issue #143)。勘定科目グループ(account_groups)と同じ仕様:
-- 入れ子可・単一所属・表示専用(集計ロジックには関与しない)。categoryは持たない
CREATE TABLE counterparty_groups (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  parent_group_id   INTEGER REFERENCES counterparty_groups(id),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_counterparty_groups_parent ON counterparty_groups(parent_group_id);

-- グループ名は同じ親グループ内でユニーク(非アクティブは除外)。最上位はCOALESCEで0に束ねる
CREATE UNIQUE INDEX idx_counterparty_groups_unique_name
ON counterparty_groups(COALESCE(parent_group_id, 0), name)
WHERE is_active = TRUE;

-- 子グループを持つグループの物理削除を禁止
CREATE TRIGGER prevent_delete_counterparty_group_with_children
BEFORE DELETE ON counterparty_groups
WHEN EXISTS (SELECT 1 FROM counterparty_groups WHERE parent_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete counterparty group with child groups');
END;

-- updated_at の自動更新
CREATE TRIGGER counterparty_groups_set_updated_at
AFTER UPDATE ON counterparty_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE counterparty_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- counterparty_group_id = NULL は未分類(CSV取込で作られた取引先の既定)
CREATE TABLE counterparties (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  default_account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  counterparty_group_id INTEGER REFERENCES counterparty_groups(id),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_counterparties_group ON counterparties(counterparty_group_id);

-- 取引先が所属するグループの物理削除を禁止
CREATE TRIGGER prevent_delete_counterparty_group_with_counterparties
BEFORE DELETE ON counterparty_groups
WHEN EXISTS (SELECT 1 FROM counterparties WHERE counterparty_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete counterparty group with counterparties');
END;

CREATE TABLE counterparty_patterns (
  id               INTEGER PRIMARY KEY,
  counterparty_id  INTEGER NOT NULL
    REFERENCES counterparties(id) ON DELETE CASCADE,
  pattern          TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_counterparty_patterns_counterparty
  ON counterparty_patterns(counterparty_id);

-- 仕訳明細が紐づく取引先の物理削除を禁止
CREATE TRIGGER prevent_delete_counterparty_with_journal_lines
BEFORE DELETE ON counterparties
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE counterparty_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete counterparty with journal lines');
END;

-- updated_at の自動更新
CREATE TRIGGER counterparties_set_updated_at
AFTER UPDATE ON counterparties
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE counterparties SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- 取引先統合(複数取引先を1取引先に集約する操作)の操作ログ
-- ドメイン定義は docs/domain/counterparties.md 1.5a を参照
CREATE TABLE counterparty_merge_log (
  id                       INTEGER PRIMARY KEY,
  target_counterparty_id   INTEGER REFERENCES counterparties(id) ON DELETE SET NULL,
  target_counterparty_name TEXT NOT NULL,
  source_counterparty_id   INTEGER REFERENCES counterparties(id) ON DELETE SET NULL,
  source_counterparty_name TEXT NOT NULL,
  line_count               INTEGER NOT NULL CHECK (line_count >= 0),
  pattern_count            INTEGER NOT NULL CHECK (pattern_count >= 0),
  merged_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_counterparty_merge_log_target ON counterparty_merge_log(target_counterparty_id);
CREATE INDEX idx_counterparty_merge_log_source ON counterparty_merge_log(source_counterparty_id);
