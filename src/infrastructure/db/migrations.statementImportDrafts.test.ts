/**
 * スキーマ v4 → v5 の差分(明細取込の一時保存の表の追加、計画Issue #231 フェーズ3)のテスト。
 * 一時保存の表(statement_import_drafts・statement_import_draft_files)が無い v4 のDB(最新のDDLから表を取り除いて作る)に
 * 差分を流し、最新スキーマからの新規作成と定義レベルで一致すること、既存の科目・マッピング定義などが保たれること、
 * 追加した表に外部キーつきで書き込めて、科目・定義の削除に連動することを検証する。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'

/** v4 のDB(一時保存の表が無く、user_version = 4)を作り、既存のデータを入れる */
async function createV4Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(sql)
  db.run('DROP TABLE statement_import_draft_files')
  db.run('DROP TABLE statement_import_drafts')
  db.run('PRAGMA user_version = 4')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run("INSERT INTO accounts (id, category, name, is_reconcilable) VALUES (1, 'asset', '普通預金', 1)")
  db.run(
    `INSERT INTO import_mapping_definitions
       (id, format_group_id, label, date_column, date_format, description_column, amount_mode, amount_column)
     VALUES (1, 'my-bank', 'マイ銀行', '日付', 'YYYY/MM/DD', '摘要', 'single_signed', '金額')`,
  )
  return db
}

const scalar = (db: Database, sql: string): number => db.exec(sql)[0].values[0][0] as number

describe('スキーマ v4 → v5(一時保存の表の追加)', () => {
  it('最新のスキーマのバージョンは5以上である', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(5)
  })

  it('v4のDBに差分を流すと、最新スキーマからの新規作成と定義レベルで一致し、バージョンが最新になる', async () => {
    const migrated = await createV4Database()
    runMigrations(migrated)
    const fresh = await createTestDatabase()
    runMigrations(fresh)

    expect(getUserVersion(migrated)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(migrated, fresh)).toEqual([])
  })

  it('既存の科目・世帯メンバー・マッピング定義は保たれる', async () => {
    const db = await createV4Database()

    runMigrations(db)

    expect(scalar(db, 'SELECT COUNT(*) FROM accounts')).toBe(1)
    expect(scalar(db, 'SELECT COUNT(*) FROM household_members')).toBe(1)
    expect(scalar(db, 'SELECT COUNT(*) FROM import_mapping_definitions')).toBe(1)
  })

  it('追加した表に、取込先の科目・定義・名義を指して一時保存を書き込め、取込先は1科目につき1つに限られる', async () => {
    const db = await createV4Database()
    runMigrations(db)

    db.run(
      `INSERT INTO statement_import_drafts (target_account_id, definition_id, owner_member_id) VALUES (1, 1, 1)`,
    )
    db.run(
      `INSERT INTO statement_import_draft_files (draft_id, file_order, file_name, content) VALUES (1, 0, 'a.csv', X'0102')`,
    )

    expect(scalar(db, 'SELECT COUNT(*) FROM statement_import_draft_files')).toBe(1)
    expect(() => db.run('INSERT INTO statement_import_drafts (target_account_id) VALUES (1)')).toThrow()
  })

  it('取込先の科目を削除すると一時保存(とCSV)も消え、定義・名義を削除しても一時保存は残って参照だけが外れる', async () => {
    const db = await createV4Database()
    runMigrations(db)
    db.run('INSERT INTO statement_import_drafts (target_account_id, definition_id, owner_member_id) VALUES (1, 1, 1)')
    db.run(`INSERT INTO statement_import_draft_files (draft_id, file_order, file_name, content) VALUES (1, 0, 'a.csv', X'01')`)

    db.run('DELETE FROM import_mapping_definitions WHERE id = 1')
    db.run('DELETE FROM household_members WHERE id = 1')
    expect(db.exec('SELECT definition_id, owner_member_id FROM statement_import_drafts')[0].values[0]).toEqual([null, null])

    db.run('DELETE FROM accounts WHERE id = 1')
    expect(scalar(db, 'SELECT COUNT(*) FROM statement_import_drafts')).toBe(0)
    expect(scalar(db, 'SELECT COUNT(*) FROM statement_import_draft_files')).toBe(0)
  })
})
