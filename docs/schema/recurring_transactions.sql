-- recurring_transaction_rules のDDL、および journal_entries への追加カラム
-- ドメイン定義・各制約の設計判断は docs/domain/recurring-transactions.md を参照

CREATE TABLE recurring_transaction_rules (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  debit_account_id      INTEGER NOT NULL REFERENCES accounts(id),
  credit_account_id     INTEGER NOT NULL REFERENCES accounts(id),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  frequency             TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  day_of_week           INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month          INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  week_of_month         INTEGER CHECK (week_of_month BETWEEN -1 AND 5 AND week_of_month != 0),
  month_of_year         INTEGER CHECK (month_of_year BETWEEN 1 AND 12),
  project_id            INTEGER REFERENCES projects(id),
  household_member_id   INTEGER REFERENCES household_members(id),
  counterparty_id       INTEGER REFERENCES counterparties(id),
  max_occurrences       INTEGER CHECK (max_occurrences IS NULL OR max_occurrences > 0),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  -- frequencyごとに使用するカラムの組み合わせを強制する(recurring-transactions.md 1.3の対応表参照)
  CHECK (
    (frequency = 'weekly'
      AND day_of_week IS NOT NULL
      AND day_of_month IS NULL AND week_of_month IS NULL AND month_of_year IS NULL)
    OR
    (frequency = 'monthly' AND month_of_year IS NULL
      AND (
        (day_of_month IS NOT NULL AND day_of_week IS NULL AND week_of_month IS NULL)
        OR
        (day_of_week IS NOT NULL AND week_of_month IS NOT NULL AND day_of_month IS NULL)
      ))
    OR
    (frequency = 'yearly'
      AND month_of_year IS NOT NULL AND day_of_month IS NOT NULL
      AND day_of_week IS NULL AND week_of_month IS NULL)
  )
);

-- 仕訳が紐づくルールの物理削除を禁止
CREATE TRIGGER prevent_delete_rule_with_journal_entries
BEFORE DELETE ON recurring_transaction_rules
WHEN EXISTS (
  SELECT 1 FROM journal_entries WHERE generated_from_rule_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete rule with generated journal entries');
END;

-- updated_at の自動更新
CREATE TRIGGER recurring_transaction_rules_set_updated_at
AFTER UPDATE ON recurring_transaction_rules
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE recurring_transaction_rules SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- journal_entries への追加(journal.sql側への反映が必要)
ALTER TABLE journal_entries
  ADD COLUMN generated_from_rule_id INTEGER
    REFERENCES recurring_transaction_rules(id);
