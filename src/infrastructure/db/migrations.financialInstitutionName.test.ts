/**
 * スキーマ v11 → v12 の差分(取込の記録に金融機関名を持たせる、計画Issue #289)のテスト。
 * external_transaction_refs.financial_institution_name の列が無い v11 のDB(最新のDDLから該当の記述を取り除いて作る)に
 * 差分を流し、最新スキーマからの新規作成と定義レベルで一致すること、既存の取込の記録は金融機関名が NULL(不明)のまま
 * 保たれ、データが変わらないことを検証する。外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'
import { toSchemaV11 } from './schemaV5ForTests'

/** v11 のDB(金融機関名の列が無く、user_version = 11)を作り、既存の取込の記録を1件入れる */
async function createV11Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV11(sql))
  db.run('PRAGMA user_version = 11')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run("INSERT INTO accounts (id, category, name, is_reconcilable) VALUES (10, 'asset', '普通預金', 1)")
  db.run("INSERT INTO journal_entries (id, entry_date, source_type, household_member_id) VALUES (1, '2026-11-01', 'external_import', 1)")
  db.run(
    `INSERT INTO external_transaction_refs (id, account_id, journal_entry_id, external_id, entry_date, description, amount)
     VALUES (1, 10, 1, 'X-1', '2026-11-01', 'ガス', -4200)`,
  )
  return db
}

describe('スキーマ v11 → v12(取込の記録の金融機関名)', () => {
  it('最新のスキーマのバージョンは12以上である', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(12)
  })

  it('v11のDBに差分を流すと、最新スキーマからの新規作成と定義レベルで一致し、バージョンが最新になる', async () => {
    const migrated = await createV11Database()
    runMigrations(migrated)
    const fresh = await createTestDatabase()
    runMigrations(fresh)

    expect(getUserVersion(migrated)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(migrated, fresh)).toEqual([])
  })

  it('既存の取込の記録は、金融機関名がNULL(不明)のまま保たれ、ほかの値は変わらない', async () => {
    const db = await createV11Database()
    runMigrations(db)

    const [result] = db.exec('SELECT financial_institution_name, external_id, description, amount FROM external_transaction_refs WHERE id = 1')
    expect(result.values[0]).toEqual([null, 'X-1', 'ガス', -4200])
  })
})
