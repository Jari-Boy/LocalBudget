/**
 * スキーマ v5 → v6 の差分(お気に入りの列 is_favorite の追加、計画Issue #231 フェーズ4)のテスト。
 * お気に入りの列が無い v5 のDB(最新のDDLから列とトリガーの1行を取り除いて作る)に差分を流し、最新スキーマからの新規作成と
 * 定義レベルで一致すること、既存の科目・取引先・プロジェクトが保たれて全件が「お気に入りでない」になること、
 * システム管理科目のお気に入りの変更をトリガーが禁止し、ふつうの科目・取引先・プロジェクトは変更できることを検証する。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'
import { toSchemaV5 } from './schemaV5ForTests'

/** v5 のDB(お気に入りの列が無く、user_version = 5)を作り、既存のデータを入れる */
async function createV5Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV5(sql))
  db.run('PRAGMA user_version = 5')
  db.run(
    `INSERT INTO accounts (id, category, name, is_reconcilable, is_system_managed) VALUES
       (1, 'expense', '食費', NULL, 0),
       (2, 'asset', '立替金', 0, 1)`,
  )
  db.run("INSERT INTO counterparties (id, name) VALUES (1, 'スーパー')")
  db.run("INSERT INTO projects (id, name) VALUES (1, '沖縄旅行')")
  return db
}

const scalar = (db: Database, sql: string): number => db.exec(sql)[0].values[0][0] as number

describe('スキーマ v5 → v6(お気に入りの列の追加)', () => {
  it('最新のスキーマのバージョンは6以上である', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(6)
  })

  it('v5のDBに差分を流すと、最新スキーマからの新規作成と定義レベルで一致し、バージョンが最新になる', async () => {
    const migrated = await createV5Database()
    runMigrations(migrated)
    const fresh = await createTestDatabase()
    runMigrations(fresh)

    expect(getUserVersion(migrated)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(migrated, fresh)).toEqual([])
  })

  it('既存の科目・取引先・プロジェクトは保たれ、全件がお気に入りでない(0)になる', async () => {
    const db = await createV5Database()

    runMigrations(db)

    expect(scalar(db, 'SELECT COUNT(*) FROM accounts WHERE is_favorite = 0')).toBe(2)
    expect(scalar(db, 'SELECT COUNT(*) FROM counterparties WHERE is_favorite = 0')).toBe(1)
    expect(scalar(db, 'SELECT COUNT(*) FROM projects WHERE is_favorite = 0')).toBe(1)
  })

  it('ふつうの科目・取引先・プロジェクトは、お気に入りを変更できる', async () => {
    const db = await createV5Database()
    runMigrations(db)

    db.run('UPDATE accounts SET is_favorite = 1 WHERE id = 1')
    db.run('UPDATE counterparties SET is_favorite = 1 WHERE id = 1')
    db.run('UPDATE projects SET is_favorite = 1 WHERE id = 1')

    expect(scalar(db, 'SELECT COUNT(*) FROM accounts WHERE is_favorite = 1')).toBe(1)
    expect(scalar(db, 'SELECT COUNT(*) FROM counterparties WHERE is_favorite = 1')).toBe(1)
    expect(scalar(db, 'SELECT COUNT(*) FROM projects WHERE is_favorite = 1')).toBe(1)
  })

  it('システム管理科目は、お気に入りを変更できない(名称・グループ・並び順以外の変更を禁じるトリガーが、DBの最終防御線になる)', async () => {
    const db = await createV5Database()
    runMigrations(db)

    expect(() => db.run('UPDATE accounts SET is_favorite = 1 WHERE id = 2')).toThrow(/system-managed accounts can only change name/)
    // 名称は、従来どおり変更できる
    db.run("UPDATE accounts SET name = '立替金(改)' WHERE id = 2")
    expect(scalar(db, 'SELECT COUNT(*) FROM accounts WHERE name = \'立替金(改)\'')).toBe(1)
  })
})
