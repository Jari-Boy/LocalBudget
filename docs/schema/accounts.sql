-- accounts / account_groups のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/accounts.md を参照

CREATE TABLE accounts (
  id                   INTEGER PRIMARY KEY,
  category             TEXT NOT NULL
    CHECK (category IN ('asset','liability','equity','revenue','expense')),
  name                 TEXT NOT NULL,
  is_reconcilable      BOOLEAN,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_managed    BOOLEAN NOT NULL DEFAULT FALSE,
  household_member_id  INTEGER REFERENCES household_members(id),
  account_group_id     INTEGER REFERENCES account_groups(id),
  initial_balance_for_account_id INTEGER REFERENCES accounts(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (category IN ('asset','liability') AND is_reconcilable IS NOT NULL) OR
    (category NOT IN ('asset','liability') AND is_reconcilable IS NULL)
  ),
  CHECK (
    initial_balance_for_account_id IS NULL OR
    (category = 'equity' AND is_system_managed = TRUE)
  )
);

CREATE INDEX idx_accounts_group ON accounts(account_group_id);
CREATE INDEX idx_accounts_initial_balance_for ON accounts(initial_balance_for_account_id);

-- 区分の変更を禁止
CREATE TRIGGER prevent_category_change
BEFORE UPDATE OF category ON accounts
WHEN OLD.category != NEW.category
BEGIN
  SELECT RAISE(ABORT, 'category cannot be changed');
END;

-- equity区分の新規作成はシステム管理科目のみ許可(ユーザーによる新規作成を禁止)
CREATE TRIGGER prevent_user_created_equity_account
BEFORE INSERT ON accounts
WHEN NEW.category = 'equity' AND NEW.is_system_managed = FALSE
BEGIN
  SELECT RAISE(ABORT, 'equity accounts can only be system-managed');
END;

-- 仕訳が紐づく科目の物理削除を禁止
CREATE TRIGGER prevent_delete_with_journal_lines
BEFORE DELETE ON accounts
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete account with journal lines');
END;

-- 勘定科目名は区分内でユニーク(非アクティブは除外)
CREATE UNIQUE INDEX idx_accounts_unique_name_per_category
ON accounts(category, name)
WHERE is_active = TRUE;

-- updated_at の自動更新
CREATE TRIGGER accounts_set_updated_at
AFTER UPDATE ON accounts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE account_groups (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  parent_group_id   INTEGER REFERENCES account_groups(id),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_account_groups_parent ON account_groups(parent_group_id);

-- 勘定科目が紐づくグループの物理削除を禁止
CREATE TRIGGER prevent_delete_account_group_with_accounts
BEFORE DELETE ON account_groups
WHEN EXISTS (SELECT 1 FROM accounts WHERE account_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete account group with accounts');
END;

-- 子グループを持つグループの物理削除を禁止
CREATE TRIGGER prevent_delete_account_group_with_children
BEFORE DELETE ON account_groups
WHEN EXISTS (SELECT 1 FROM account_groups WHERE parent_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete account group with child groups');
END;

-- グループ名はユニーク(非アクティブは除外)
CREATE UNIQUE INDEX idx_account_groups_unique_name
ON account_groups(name)
WHERE is_active = TRUE;

-- updated_at の自動更新
CREATE TRIGGER account_groups_set_updated_at
AFTER UPDATE ON account_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE account_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;
