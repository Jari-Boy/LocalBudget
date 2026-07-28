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

-- account_id は is_reconcilable = true の科目のみ許可(資産の口座、または負債のクレカ専用未払金)
-- is_reconcilable が NOT NULL なのは asset/liability 区分のみ(accounts.sqlのCHECK制約で保証済み)
-- (CHECK制約はサブクエリ不可のためTRIGGERで実装)
CREATE TRIGGER prevent_external_ref_on_non_reconcilable_account
BEFORE INSERT ON external_transaction_refs
WHEN (SELECT is_reconcilable FROM accounts WHERE id = NEW.account_id) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'external_transaction_refs can only reference reconcilable accounts');
END;
