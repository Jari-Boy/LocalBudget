-- import_mapping_definitions のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/statement-import.md を参照

CREATE TABLE import_mapping_definitions (
  id                    INTEGER PRIMARY KEY,
  format_group_id       TEXT NOT NULL,
  is_settled            BOOLEAN,
  label                 TEXT NOT NULL,
  encoding              TEXT NOT NULL DEFAULT 'utf-8',
  delimiter             TEXT NOT NULL DEFAULT ',',
  header_row_count      INTEGER NOT NULL DEFAULT 1,
  date_column           TEXT NOT NULL,
  date_format           TEXT NOT NULL,
  description_column    TEXT NOT NULL,
  amount_mode           TEXT NOT NULL CHECK (amount_mode IN ('single_signed', 'debit_credit_split')),
  amount_column         TEXT,
  debit_column          TEXT,
  credit_column         TEXT,
  balance_column        TEXT,
  external_id_column    TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (amount_mode = 'single_signed'
      AND amount_column IS NOT NULL AND debit_column IS NULL AND credit_column IS NULL) OR
    (amount_mode = 'debit_credit_split'
      AND amount_column IS NULL AND debit_column IS NOT NULL AND credit_column IS NOT NULL)
  )
);

CREATE INDEX idx_import_mapping_definitions_format_group ON import_mapping_definitions(format_group_id);

-- 定義と科目の多対多の紐づけ。制限ではなく取込時の候補の優先順位として使う
-- (docs/domain/statement-import.md 2.1・2.3)。定義・科目のどちらを削除しても、紐づけだけが消える
CREATE TABLE import_mapping_definition_accounts (
  definition_id         INTEGER NOT NULL REFERENCES import_mapping_definitions(id) ON DELETE CASCADE,
  account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (definition_id, account_id)
);

CREATE INDEX idx_import_mapping_definition_accounts_account ON import_mapping_definition_accounts(account_id);

-- updated_at の自動更新
CREATE TRIGGER import_mapping_definitions_set_updated_at
AFTER UPDATE ON import_mapping_definitions
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE import_mapping_definitions SET updated_at = datetime('now') WHERE id = NEW.id;
END;
