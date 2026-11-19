import type { MigrationStep } from './migrations'

/**
 * スキーマ v5 → v6 の差分(お気に入りの列の追加、計画Issue #231 フェーズ4)。
 * 科目・取引先・プロジェクトに、お気に入りの列(is_favorite、既定は「お気に入りでない」)を足し、
 * システム管理科目のお気に入りの変更を禁じるよう、トリガーを作り直す(列の追加だけではトリガーの条件に入らないため)。
 * 既存の行はすべて「お気に入りでない」になる。
 *
 * この差分は凍結されたバージョンの記録なので、後から最新のDDL(docs/schema/*.sql)が変わっても書き換えない。
 * トリガーの定義は、v5時点のもの(v2の差分で役割の条件が入った形)に、お気に入りの1行を足したものを写して持つ。
 */
export const MIGRATION_V6_FAVORITES: readonly MigrationStep[] = [
  'ALTER TABLE accounts ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE counterparties ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE projects ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT FALSE',
  'DROP TRIGGER prevent_non_name_change_on_system_managed_account',
  `CREATE TRIGGER prevent_non_name_change_on_system_managed_account
   BEFORE UPDATE ON accounts
   WHEN OLD.is_system_managed = TRUE
     AND (
       NEW.is_active IS NOT OLD.is_active OR
       NEW.is_favorite IS NOT OLD.is_favorite OR
       NEW.household_member_id IS NOT OLD.household_member_id OR
       NEW.is_reconcilable IS NOT OLD.is_reconcilable OR
       NEW.is_system_managed IS NOT OLD.is_system_managed OR
       (OLD.system_role IS NOT NULL AND NEW.system_role IS NOT OLD.system_role)
     )
   BEGIN
     SELECT RAISE(ABORT, 'system-managed accounts can only change name');
   END`,
]
