-- counterparties / counterparty_patterns のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/counterparties.md を参照

CREATE TABLE counterparties (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  default_account_id  INTEGER REFERENCES accounts(id),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

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
