-- budgets のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/budgets.md を参照

CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  year_month  TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, year_month)
);

CREATE INDEX idx_budgets_year_month ON budgets(year_month);

-- 予算はexpense区分の科目にのみ設定可能
-- (CHECK制約はサブクエリ不可のためTRIGGERで実装。journal.mdのproject_id/counterparty_id制約と同じ理由)
CREATE TRIGGER prevent_budget_on_non_expense_insert
BEFORE INSERT ON budgets
WHEN (SELECT category FROM accounts WHERE id = NEW.account_id) != 'expense'
BEGIN
  SELECT RAISE(ABORT, 'budgets can only be set on expense accounts');
END;

CREATE TRIGGER prevent_budget_on_non_expense_update
BEFORE UPDATE ON budgets
WHEN (SELECT category FROM accounts WHERE id = NEW.account_id) != 'expense'
BEGIN
  SELECT RAISE(ABORT, 'budgets can only be set on expense accounts');
END;

-- updated_at の自動更新
CREATE TRIGGER budgets_set_updated_at
AFTER UPDATE ON budgets
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE budgets SET updated_at = datetime('now') WHERE id = NEW.id;
END;
