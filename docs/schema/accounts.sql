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

-- 仕訳・予算・定期取引ルールが紐づく科目の物理削除を禁止
-- (budgets.account_id・recurring_transaction_rules.debit_account_id/credit_account_id は
--  ON DELETEアクションを持たないFKのため、ここで参照の有無を検証する。
--  household_membersのprevent_delete_member_with_referencesと同じパターン)
CREATE TRIGGER prevent_delete_account_with_references
BEFORE DELETE ON accounts
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id)
  OR EXISTS (SELECT 1 FROM budgets WHERE account_id = OLD.id)
  OR EXISTS (SELECT 1 FROM recurring_transaction_rules
             WHERE debit_account_id = OLD.id OR credit_account_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete account with references');
END;

-- 勘定科目名は区分内でユニーク(非アクティブは除外)
CREATE UNIQUE INDEX idx_accounts_unique_name_per_category
ON accounts(category, name)
WHERE is_active = TRUE;

-- システム管理科目(is_system_managed = TRUE)の削除を禁止
-- (domain/accounts.md 3.1: 口座ごとの初期残高科目・残高調整などは削除・区分変更・
--  非アクティブ化を禁止し、nameの変更のみ許可する)
CREATE TRIGGER prevent_delete_system_managed_account
BEFORE DELETE ON accounts
WHEN OLD.is_system_managed = TRUE
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a system-managed account');
END;

-- システム管理科目のname以外のフィールド変更を禁止(非アクティブ化を含む)
-- 区分(category)の変更はprevent_category_changeで全科目共通に禁止済みのためここでは扱わない
CREATE TRIGGER prevent_non_name_change_on_system_managed_account
BEFORE UPDATE ON accounts
WHEN OLD.is_system_managed = TRUE
  AND (
    NEW.is_active IS NOT OLD.is_active OR
    NEW.household_member_id IS NOT OLD.household_member_id OR
    NEW.account_group_id IS NOT OLD.account_group_id OR
    NEW.is_reconcilable IS NOT OLD.is_reconcilable OR
    NEW.is_system_managed IS NOT OLD.is_system_managed OR
    NEW.initial_balance_for_account_id IS NOT OLD.initial_balance_for_account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'system-managed accounts can only change name');
END;

-- updated_at の自動更新
CREATE TRIGGER accounts_set_updated_at
AFTER UPDATE ON accounts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- 科目統合(複数科目を1科目に集約する操作)の操作ログ
-- ドメイン定義は docs/domain/accounts.md 2.2 を参照
CREATE TABLE account_merge_log (
  id                   INTEGER PRIMARY KEY,
  target_account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  target_account_name  TEXT NOT NULL,
  source_account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  source_account_name  TEXT NOT NULL,
  line_count           INTEGER NOT NULL CHECK (line_count >= 0),
  merged_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_account_merge_log_target ON account_merge_log(target_account_id);
CREATE INDEX idx_account_merge_log_source ON account_merge_log(source_account_id);

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

-- グループ名は同じ親グループ内でユニーク(非アクティブは除外)。
-- parent_group_id = NULL(最上位)はCOALESCEで0に束ね、最上位グループ同士の重複も検出する
CREATE UNIQUE INDEX idx_account_groups_unique_name
ON account_groups(COALESCE(parent_group_id, 0), name)
WHERE is_active = TRUE;

-- updated_at の自動更新
CREATE TRIGGER account_groups_set_updated_at
AFTER UPDATE ON account_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE account_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;
