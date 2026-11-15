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
  it('docs/schema/*.sqlに定義された全テーブルを作成する', async () => {
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
        'settlement_batches',
        'journal_entries',
        'journal_lines',
        'journal_entry_link_groups',
        'journal_entry_link_group_memberships',
        'journal_entry_drafts',
        'journal_entry_draft_lines',
        'budgets',
        'recurring_transaction_rules',
        'external_transaction_refs',
        'import_mapping_definitions',
        'import_mapping_definition_accounts',
        'journal_template_groups',
        'journal_templates',
        'journal_template_lines',
      ]),
    )
  })

  it('PRAGMA user_versionを最新のスキーマバージョンに設定する', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('2回実行しても適用済みのマイグレーションを再適用しない', async () => {
    const db = await createTestDatabase()
    runMigrations(db)

    expect(() => runMigrations(db)).not.toThrow()
    expect(getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('仕訳テンプレートの表はバージョン2で追加され、バージョン1のDBはデータを保ったまま上がる(計画Issue #201)', async () => {
    const db = await createTestDatabase()
    runMigrations(db)
    // バージョン1のDB(テンプレートの表が無い)を再現する
    db.run('DROP TABLE journal_template_lines')
    db.run('DROP TABLE journal_templates')
    db.run('DROP TABLE journal_template_groups')
    db.run('PRAGMA user_version = 1')
    db.run(`INSERT INTO household_members (name) VALUES ('自分')`)

    runMigrations(db)

    expect(getUserVersion(db)).toBe(2)
    expect(listTableNames(db)).toEqual(expect.arrayContaining(['journal_templates', 'journal_template_groups']))
    expect(db.exec('SELECT COUNT(*) FROM household_members')[0].values[0][0]).toBe(1)
  })

  it('recurring_transactions.sqlのALTER TABLEをjournal_entriesに適用する', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(listColumnNames(db, 'journal_entries')).toContain(
      'generated_from_rule_id',
    )
  })

  it('journal_entriesに起票者を表すhousehold_member_idカラムを追加する(計画Issue #88)', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(listColumnNames(db, 'journal_entries')).toContain('household_member_id')
  })

  it('journal_entry_draftsにも起票者を表すhousehold_member_idカラムを追加する(計画Issue #88)', async () => {
    const db = await createTestDatabase()

    runMigrations(db)

    expect(listColumnNames(db, 'journal_entry_drafts')).toContain('household_member_id')
  })
})
