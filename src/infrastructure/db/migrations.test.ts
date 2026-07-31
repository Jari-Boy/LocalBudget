/**
 * migrations.ts の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/schema/配下の全DDLが
 * 初回マイグレーションで一括適用されることを検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'

function listTableNames(db: Database): string[] {
  const result = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )
  return result[0]?.values.map((row) => row[0] as string) ?? []
}

function listColumnNames(db: Database, table: string): string[] {
  const result = db.exec(`PRAGMA table_info(${table})`)
  const nameColumnIndex = result[0]?.columns.indexOf('name') ?? -1
  return result[0]?.values.map((row) => row[nameColumnIndex] as string) ?? []
}

describe('runMigrations', () => {
  it('creates all tables defined across docs/schema/*.sql', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(listTableNames(db)).toEqual(
      expect.arrayContaining([
        'accounts',
        'account_groups',
        'account_merge_log',
        'household_members',
        'household_member_group_memberships',
        'projects',
        'counterparties',
        'counterparty_patterns',
        'counterparty_merge_log',
        'journal_entries',
        'journal_lines',
        'journal_entry_links',
        'journal_entry_drafts',
        'journal_entry_draft_lines',
        'budgets',
        'recurring_transaction_rules',
        'external_transaction_refs',
        'import_mapping_definitions',
      ]),
    )
  })

  it('sets PRAGMA user_version to the latest schema version', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('does not re-apply already-applied migrations when run twice', async () => {
    const db = await createTestDatabase()
    runMigrations(db)

    expect(() => runMigrations(db)).not.toThrow()
    expect(getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('applies the recurring_transactions.sql ALTER TABLE onto journal_entries', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(listColumnNames(db, 'journal_entries')).toContain(
      'generated_from_rule_id',
    )
  })
})
