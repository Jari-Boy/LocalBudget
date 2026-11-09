import type { Database } from 'sql.js'
import { InvalidBackupFileError } from './InvalidBackupFileError'

/**
 * migrations.tsが適用する10個のスキーマファイル(docs/schema/*.sql)それぞれに1つずつ、
 * 代表的なテーブル名を列挙する。全テーブルは列挙せず、インポートされたファイルが
 * LocalBudgetのDBかどうかを判別するための最小限の指標として使う。settlement_batches
 * (計画Issue #133)を追加。
 */
const REQUIRED_TABLE_NAMES = [
  'household_members',
  'accounts',
  'projects',
  'counterparties',
  'settlement_batches',
  'journal_entries',
  'budgets',
  'recurring_transaction_rules',
  'external_transaction_refs',
  'import_mapping_definitions',
] as const

/**
 * インポートされたDBが実際にLocalBudgetのスキーマを持つかを検証する
 * (docs/architecture.md 8章、計画Issue #26の懸念点「runMigrations単体では検証が弱い」
 * への対応)。runMigrations単体は、PRAGMA user_versionが既に最新版のDBに対しては
 * CREATE TABLE群を実行しないため(migrations.ts参照)、無関係なsql.js製DBファイルが
 * 偶然versionだけ一致していた場合を検知できない。本関数はsqlite_masterを直接確認し、
 * 想定テーブルが揃っているかを判定する。
 */
export function assertValidDatabaseSchema(db: Database): void {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")
  const tableNames = new Set(result[0]?.values.map((row) => row[0]) ?? [])
  const missing = REQUIRED_TABLE_NAMES.filter((name) => !tableNames.has(name))

  if (missing.length > 0) {
    throw new InvalidBackupFileError(`invalid backup file: missing expected tables (${missing.join(', ')})`)
  }

  // 計画Issue #169: 明細行の世帯メンバーがNOT NULLになった。移行は行わない(旧バックアップの取込は対象外)ため、
  // NULL許容の旧スキーマのDBは、制約が効かない状態で取り込まれないようここで拒否する
  const lineColumns = db.exec('PRAGMA table_info(journal_lines)')[0]?.values ?? []
  const memberColumn = lineColumns.find((row) => row[1] === 'household_member_id')
  if (memberColumn === undefined || memberColumn[3] !== 1) {
    throw new InvalidBackupFileError(
      'invalid backup file: journal_lines.household_member_id must be NOT NULL (backups created before this constraint are not supported)',
    )
  }
}
