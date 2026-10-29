import type { Database } from 'sql.js'
import { InvalidBackupFileError } from './InvalidBackupFileError'

/**
 * migrations.tsが適用する9つのスキーマファイル(docs/schema/*.sql)それぞれに1つずつ、
 * 代表的なテーブル名を列挙する。全17テーブルは列挙せず、インポートされたファイルが
 * LocalBudgetのDBかどうかを判別するための最小限の指標として使う。
 */
const REQUIRED_TABLE_NAMES = [
  'household_members',
  'accounts',
  'projects',
  'counterparties',
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

  assertJournalEntryLinksIsLineLevel(db)
}

/**
 * journal_entry_linksが明細行単位(from_line_id/to_line_id)であることを確認する(計画Issue #132)。
 * 仕訳単位(from_entry_id/to_entry_id)だった旧形式のバックアップは、テーブルの有無だけでは
 * 見分けられず、そのまま読み込むとリンクの取得時にSQLエラーになるため、ここで弾く。
 */
function assertJournalEntryLinksIsLineLevel(db: Database): void {
  const result = db.exec('PRAGMA table_info(journal_entry_links)')
  const columnNames = new Set(result[0]?.values.map((row) => row[1]) ?? [])
  const missing = ['from_line_id', 'to_line_id'].filter((name) => !columnNames.has(name))

  if (missing.length > 0) {
    throw new InvalidBackupFileError(
      `invalid backup file: journal_entry_links is missing expected columns (${missing.join(', ')}); ` +
        'the backup was created with an older schema',
    )
  }
}
