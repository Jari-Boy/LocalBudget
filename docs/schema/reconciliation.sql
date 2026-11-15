-- external_transaction_refs のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/reconciliation.md を参照

CREATE TABLE external_transaction_refs (
  id                      INTEGER PRIMARY KEY,
  account_id              INTEGER NOT NULL REFERENCES accounts(id),
  journal_entry_id        INTEGER NOT NULL
    REFERENCES journal_entries(id) ON DELETE CASCADE,
  external_id             TEXT NOT NULL,
  entry_date              TEXT NOT NULL,
  description             TEXT NOT NULL,
  amount                  INTEGER NOT NULL,
  external_balance_after  INTEGER,
  -- 取込時のCSV上の行の順番(0始まり、計画Issue #205)。同じ日の複数行の「最後の残高」と
  -- 並び順(昇順/降順)の判定に使う。既存データはNULLでid順で代用する
  row_order               INTEGER,
  is_settled              BOOLEAN,
  imported_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_external_txn_refs_dedup
  ON external_transaction_refs(account_id, external_id);
CREATE INDEX idx_external_txn_refs_entry
  ON external_transaction_refs(journal_entry_id);

-- account_id に is_reconcilable = true を強制するTRIGGERは設けない。
-- external_transaction_refs は「外部明細の取込対象としてユーザーが選んだ科目」に
-- 対して機械的に作られるレコードであり、is_reconcilable の値とは無関係に成立する
-- (asset の銀行口座等だけでなく、liability のクレカ専用未払金も対象になる)。
-- 詳細は docs/domain/reconciliation.md 2.1「なぜaccount_idにTRIGGER制約を設けないか」参照。

-- 手で記録した残高(基準点、計画Issue #205)。取引後残高のあるCSVの科目は使わず、現金・残高列の無い
-- CSVの科目・クレジットカード未払金などが使う。日付 record_date の終わり時点の正しい残高を表す。
-- 同じ科目・同じ日は1件だけ。科目を削除するときは一緒に消える
CREATE TABLE account_balance_records (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  record_date  TEXT NOT NULL,
  balance      INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_account_balance_records_date
  ON account_balance_records(account_id, record_date);
