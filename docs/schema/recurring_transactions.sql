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

-- 見送った提案(計画Issue #145、recurring-transactions.md 1.2・1.7参照)。
-- 提案は生成済みの仕訳の最新entry_dateから都度導出しており、見送りは仕訳を作らないため、
-- この導出だけでは進捗を表現できない。見送った対象日だけを記録し、導出の起点に加える
-- (見送りの取り消しは作らない。max_occurrencesの回数にも数えない)。
-- ルールを削除するときは見送りの記録も一緒に削除する(帳簿データではなく進捗の印にすぎないため。
-- 生成済みの仕訳があるルールは従来どおり下のTRIGGERで物理削除できない)。
CREATE TABLE recurring_transaction_skips (
  rule_id    INTEGER NOT NULL REFERENCES recurring_transaction_rules(id) ON DELETE CASCADE,
  due_date   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (rule_id, due_date)
);

-- debit_account_id / credit_account_id には is_reconcilable = true の科目も指定できる
-- (計画Issue #145で、reconciliation.md 1.2の直接記帳制限とともに指定禁止のTRIGGERを廃止した)

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
