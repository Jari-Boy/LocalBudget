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
