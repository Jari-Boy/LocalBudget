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
  -- 金額の符号を反転して読む(single_signed のみ有効。docs/domain/statement-import.md 1.2・2.1)
  invert_amount_sign    BOOLEAN NOT NULL DEFAULT 0,
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

-- 明細取込の一時保存(計画Issue #231 フェーズ3、docs/domain/statement-import.md 1.9)。
-- 件数が多いCSVを1回で入力しきれないときに、取込作業を途中で中断し、後から続きを再開するために持つ。
-- 取込先の科目ごとに1つ(UNIQUE)。同じ取込先で保存し直すと上書きする。全行を確定したとき・破棄したときに削除し、
-- CSVの生データ(銀行明細)をDBに残さない。取込先の科目を削除すると一時保存も消える(ON DELETE CASCADE)。
-- マッピング定義・名義の世帯メンバーを削除しても一時保存は残し、参照だけを外す(ON DELETE SET NULL。再開時に定義を作り直せる)。
CREATE TABLE statement_import_drafts (
  id                INTEGER PRIMARY KEY,
  target_account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  definition_id     INTEGER REFERENCES import_mapping_definitions(id) ON DELETE SET NULL,
  owner_member_id   INTEGER REFERENCES household_members(id) ON DELETE SET NULL,
  -- 行ごとの入力(外部取引ID → 初期値から変えた項目)のJSON。参照先(科目・取引先など)は外部キーを張れないので、再開時に検証する
  row_inputs        TEXT NOT NULL DEFAULT '{}',
  -- 保存時点の取り込み対象の全件数と、そのうち投入できた(相手科目が決まっている)件数。開始状態の一覧の表示用
  total_rows        INTEGER NOT NULL DEFAULT 0,
  filled_rows       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 一時保存したCSV(生データ)。取り込んだ全ファイルを選んだ順に持ち、取り込むファイルのチェックも覚える
CREATE TABLE statement_import_draft_files (
  id         INTEGER PRIMARY KEY,
  draft_id   INTEGER NOT NULL REFERENCES statement_import_drafts(id) ON DELETE CASCADE,
  file_order INTEGER NOT NULL,
  file_name  TEXT NOT NULL,
  content    BLOB NOT NULL,
  is_checked BOOLEAN NOT NULL DEFAULT 1,
  UNIQUE (draft_id, file_order)
);
