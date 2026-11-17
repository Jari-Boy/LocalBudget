import type { MigrationStep } from './migrations'

/**
 * スキーマ v1 → v2(計画Issue #223): accounts に system_role(システム管理科目の役割)を足す。
 * 役割と区分・システム管理の対応を表すテーブルレベルのCHECKは ALTER TABLE ADD COLUMN では足せないため、
 * docs/guides/schema-migration.md 4.2 のとおり、accounts を作り直す
 * (accounts_new を作る → 行を写す → 旧表を削除 → 名前を戻す → インデックス・トリガーを作り直す)。
 * 外部キー検査は runMigrations が差分の外で止めている。他の表が accounts を参照する外部キーは、
 * 表名で解決されるので、作り直しの後もそのまま有効である。
 *
 * この差分は凍結されたバージョンの記録なので、後から最新のDDL(docs/schema/accounts.sql)が変わっても
 * 書き換えない(以後の変更は新しいバージョンの差分で行う)。
 *
 * データの移行: 名前が一致する、役割の無い通常科目の「雑収入」(収益)・「雑損失」(費用)に、システム管理と役割を付ける。
 * 費用のシステム管理科目(これまでは「残高調整」だけ)には、残高調整の役割を付ける。一致する科目が無い
 * (改名済み等の)ときは何もせず、起動時のシード(ensureSystemRoleAccount)が新規に投入する。
 */
export const MIGRATION_V2_SYSTEM_ROLE: readonly MigrationStep[] = [
  `CREATE TABLE accounts_new (
    id                   INTEGER PRIMARY KEY,
    category             TEXT NOT NULL
      CHECK (category IN ('asset','liability','equity','revenue','expense')),
    name                 TEXT NOT NULL,
    is_reconcilable      BOOLEAN,
    has_external_statement BOOLEAN,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_system_managed    BOOLEAN NOT NULL DEFAULT FALSE,
    system_role          TEXT
      CHECK (system_role IN ('settlement_gain','settlement_loss','balance_adjustment')),
    auto_balance_adjustment BOOLEAN NOT NULL DEFAULT TRUE,
    household_member_id  INTEGER REFERENCES household_members(id),
    account_group_id     INTEGER REFERENCES account_groups(id),
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
      (category IN ('asset','liability') AND is_reconcilable IS NOT NULL) OR
      (category NOT IN ('asset','liability') AND is_reconcilable IS NULL)
    ),
    CHECK (category IN ('asset','liability') OR has_external_statement IS NULL),
    CHECK (NOT (is_reconcilable = TRUE AND has_external_statement = FALSE)),
    CHECK (
      system_role IS NULL OR (
        is_system_managed = TRUE AND
        category = CASE system_role WHEN 'settlement_gain' THEN 'revenue' ELSE 'expense' END
      )
    )
  )`,
  `INSERT INTO accounts_new
    (id, category, name, is_reconcilable, has_external_statement, is_active, is_system_managed,
     auto_balance_adjustment, household_member_id, account_group_id, sort_order, created_at, updated_at)
   SELECT id, category, name, is_reconcilable, has_external_statement, is_active, is_system_managed,
     auto_balance_adjustment, household_member_id, account_group_id, sort_order, created_at, updated_at
   FROM accounts`,
  // 残高調整 → 雑収入 → 雑損失の順。残高調整は「役割の無い費用のシステム管理科目」の最小idで、雑損失を先に
  // システム管理にすると取り違えるため、必ず最初に付ける
  `UPDATE accounts_new SET system_role = 'balance_adjustment'
   WHERE id = (SELECT MIN(id) FROM accounts_new
               WHERE category = 'expense' AND is_system_managed = 1 AND system_role IS NULL)`,
  `UPDATE accounts_new SET is_system_managed = 1, system_role = 'settlement_gain'
   WHERE id = (SELECT MIN(id) FROM accounts_new
               WHERE category = 'revenue' AND name = '雑収入' AND is_active = 1
                 AND is_system_managed = 0 AND system_role IS NULL)`,
  `UPDATE accounts_new SET is_system_managed = 1, system_role = 'settlement_loss'
   WHERE id = (SELECT MIN(id) FROM accounts_new
               WHERE category = 'expense' AND name = '雑損失' AND is_active = 1
                 AND is_system_managed = 0 AND system_role IS NULL)`,
  'DROP TABLE accounts',
  // 旧表を消した直後は、他の表のトリガー(household_membersの削除防止など)が参照する accounts が一瞬無く、
  // RENAME が全トリガーの参照を検査して失敗する。従来方式の名前変更(参照を検査・書き換えしない)に一時的に切り替える
  'PRAGMA legacy_alter_table = ON',
  'ALTER TABLE accounts_new RENAME TO accounts',
  'PRAGMA legacy_alter_table = OFF',

  'CREATE INDEX idx_accounts_group ON accounts(account_group_id)',
  `CREATE UNIQUE INDEX idx_accounts_unique_name_per_category
   ON accounts(category, name)
   WHERE is_active = TRUE`,
  `CREATE UNIQUE INDEX idx_accounts_unique_system_role
   ON accounts(system_role)
   WHERE system_role IS NOT NULL`,
  `CREATE TRIGGER prevent_category_change
   BEFORE UPDATE OF category ON accounts
   WHEN OLD.category != NEW.category
   BEGIN
     SELECT RAISE(ABORT, 'category cannot be changed');
   END`,
  `CREATE TRIGGER prevent_user_created_equity_account
   BEFORE INSERT ON accounts
   WHEN NEW.category = 'equity' AND NEW.is_system_managed = FALSE
   BEGIN
     SELECT RAISE(ABORT, 'equity accounts can only be system-managed');
   END`,
  `CREATE TRIGGER prevent_delete_account_with_references
   BEFORE DELETE ON accounts
   WHEN EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM budgets WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM recurring_transaction_rule_lines WHERE account_id = OLD.id)
   BEGIN
     SELECT RAISE(ABORT, 'cannot delete account with references');
   END`,
  `CREATE TRIGGER prevent_delete_system_managed_account
   BEFORE DELETE ON accounts
   WHEN OLD.is_system_managed = TRUE
   BEGIN
     SELECT RAISE(ABORT, 'cannot delete a system-managed account');
   END`,
  `CREATE TRIGGER prevent_non_name_change_on_system_managed_account
   BEFORE UPDATE ON accounts
   WHEN OLD.is_system_managed = TRUE
     AND (
       NEW.is_active IS NOT OLD.is_active OR
       NEW.household_member_id IS NOT OLD.household_member_id OR
       NEW.is_reconcilable IS NOT OLD.is_reconcilable OR
       NEW.is_system_managed IS NOT OLD.is_system_managed OR
       (OLD.system_role IS NOT NULL AND NEW.system_role IS NOT OLD.system_role)
     )
   BEGIN
     SELECT RAISE(ABORT, 'system-managed accounts can only change name');
   END`,
  `CREATE TRIGGER accounts_set_updated_at
   AFTER UPDATE ON accounts
   WHEN NEW.updated_at = OLD.updated_at
   BEGIN
     UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id;
   END`,
  `CREATE TRIGGER prevent_account_group_category_mismatch_on_insert
   BEFORE INSERT ON accounts
   WHEN NEW.account_group_id IS NOT NULL
     AND (SELECT category FROM account_groups WHERE id = NEW.account_group_id) != NEW.category
   BEGIN
     SELECT RAISE(ABORT, 'account category must match its account group category');
   END`,
  `CREATE TRIGGER prevent_account_group_category_mismatch_on_update
   BEFORE UPDATE OF account_group_id ON accounts
   WHEN NEW.account_group_id IS NOT NULL
     AND (SELECT category FROM account_groups WHERE id = NEW.account_group_id) != NEW.category
   BEGIN
     SELECT RAISE(ABORT, 'account category must match its account group category');
   END`,
  // 他のスキーマファイル(keyword_rules.sql)が accounts に付けているトリガーも、DROP TABLE で消えるので作り直す
  `CREATE TRIGGER prepare_keyword_rules_on_account_delete
   BEFORE DELETE ON accounts
   BEGIN
     DELETE FROM keyword_rules WHERE account_id = OLD.id AND counterparty_id IS NULL;
     UPDATE keyword_rules SET account_id = NULL WHERE account_id = OLD.id;
   END`,
]
