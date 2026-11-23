/**
 * スキーマ v7 → v8 の差分(割勘対象行の記録の表の追加、計画Issue #271)のテスト。
 * 表が無い v7 のDB(最新のDDLから該当の記述を取り除いて作る)に差分を流し、最新スキーマからの新規作成と定義レベルで一致すること、
 * 既存の仕訳(割勘仕訳を含む)が保たれて割勘対象行の記録が空になること、追加後は記録がある行の変更を
 * トリガーが拒否することを検証する。外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'
import { toSchemaV7 } from './schemaV5ForTests'

/** v7 のDB(割勘対象行の表が無く、user_version = 7)を作り、既存の仕訳(従来の割勘仕訳を含む)を入れる */
async function createV7Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV7(sql))
  db.run('PRAGMA user_version = 7')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run(
    `INSERT INTO accounts (id, category, name, is_reconcilable, is_system_managed) VALUES
       (1, 'expense', '食費', NULL, 0), (2, 'asset', '現金', 0, 0)`,
  )
  db.run(
    `INSERT INTO journal_entries (id, entry_date, source_type, household_member_id) VALUES
       (1, '2026-11-01', 'manual', 1), (2, '2026-11-02', 'expense_splitting', 1)`,
  )
  db.run(
    `INSERT INTO journal_lines (id, journal_entry_id, account_id, household_member_id, side, amount) VALUES
       (1, 1, 1, 1, 'debit', 800), (2, 1, 2, 1, 'credit', 800), (3, 2, 1, 1, 'debit', 400), (4, 2, 2, 1, 'credit', 400)`,
  )
  return db
}

describe('スキーマ v7 → v8(割勘対象行の記録の追加)', () => {
  it('最新のスキーマのバージョンは8以上である', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(8)
  })

  it('v7のDBに差分を流すと、最新スキーマからの新規作成と定義レベルで一致し、バージョンが最新になる', async () => {
    const migrated = await createV7Database()
    runMigrations(migrated)
    const fresh = await createTestDatabase()
    runMigrations(fresh)

    expect(getUserVersion(migrated)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(migrated, fresh)).toEqual([])
  })

  it('既存の仕訳は保たれ、割勘対象行の記録は空になる(従来の割勘仕訳は仕訳単位の割勘済みのまま)', async () => {
    const db = await createV7Database()
    runMigrations(db)
    expect(db.exec('SELECT COUNT(*) FROM journal_entries')[0].values[0][0]).toBe(2)
    expect(db.exec('SELECT COUNT(*) FROM expense_split_source_lines')[0].values[0][0]).toBe(0)
  })

  it('差分を流したあと、記録がある行の金額の変更はトリガーが拒否する', async () => {
    const db = await createV7Database()
    runMigrations(db)
    db.run('INSERT INTO expense_split_source_lines (split_entry_id, source_line_id) VALUES (2, 1)')
    expect(() => db.run('UPDATE journal_lines SET amount = 700 WHERE id = 1')).toThrow(/cannot change/)
    db.run('UPDATE journal_lines SET amount = 900 WHERE id = 2')
  })
})
