/**
 * スキーマ v1 → v2 の差分(accounts.system_role の追加、計画Issue #223)のテスト。
 * 役割(system_role)の無い v1 のDB(最新のDDLから役割の部分だけ取り除いて作る)に差分を流し、
 * 列・制約・インデックス・トリガーが最新スキーマからの新規作成と定義レベルで一致すること、
 * 既存の科目(id・世帯メンバー・グループ)が保たれること、名前の一致する雑収入・雑損失・
 * 残高調整に役割が付くこと、役割の無い場合は起動時のシードが補うことを検証する。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import accountsSql from '../../../docs/schema/accounts.sql?raw'
import { createTestDatabase } from './createTestDatabase'
import { toSchemaV5 } from './schemaV5ForTests'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedSettlementAdjustmentAccounts } from './seedSettlementAdjustmentAccounts'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/** 最新の accounts.sql から、役割(system_role)に関する部分を取り除いた v1 のDDL */
function toV1AccountsSql(latest: string): string {
  const v1 = latest
    .replace(/ {2}-- システム管理科目の役割[\s\S]*?CHECK \(system_role IN \([^)]*\)\),\n/, '')
    .replace(/,\n {2}-- 役割を持てるのは[\s\S]*?\n {2}\)\n\);/, '\n);')
    .replace(/-- 同じ役割の科目は1件だけ[\s\S]*?WHERE system_role IS NOT NULL;\n/, '')
    .replace(/ OR\n {4}\(OLD\.system_role IS NOT NULL AND NEW\.system_role IS NOT OLD\.system_role\)/, '')
  if (v1.includes('system_role')) throw new Error('v1のDDLに役割の記述が残っている')
  return v1
}

/** v1 のDB(役割の列が無く、user_version = 1)を作り、旧データを入れる */
async function createV1Database(options: { withRoleNames?: boolean } = {}): Promise<Database> {
  const { withRoleNames = true } = options
  const db = await createTestDatabase()
  const v1AccountsSql = toV1AccountsSql(toSchemaV5(accountsSql))
  for (const sql of LATEST_SCHEMA_SQL) db.run(sql === accountsSql ? v1AccountsSql : toSchemaV5(sql))
  // v5(計画Issue #231 フェーズ3)で足した一時保存の表は、このバージョンには無いので取り除く
  db.run('DROP TABLE statement_import_draft_files')
  db.run('DROP TABLE statement_import_drafts')
  db.run('PRAGMA user_version = 1')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run("INSERT INTO account_groups (id, name, category) VALUES (1, '日常', 'expense')")
  db.run(
    `INSERT INTO accounts (id, category, name, is_reconcilable, is_system_managed, household_member_id, account_group_id)
     VALUES (1, 'expense', '食費', NULL, 0, 1, 1)`,
  )
  if (withRoleNames) {
    db.run(
      `INSERT INTO accounts (id, category, name, is_reconcilable, is_system_managed) VALUES
         (2, 'revenue', '雑収入', NULL, 0),
         (3, 'expense', '雑損失', NULL, 0),
         (4, 'expense', '帳簿の調整', NULL, 1)`,
    )
  }
  return db
}

describe('スキーマ v1 → v2(accounts.system_role の追加)', () => {
  it('最新のスキーマのバージョンは2以上である(v3以降の差分は別のテストで確かめる)', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(2)
  })

  it('v1のDBに差分を流すと、最新スキーマからの新規作成と定義レベルで一致し、バージョンが最新になる', async () => {
    const migrated = await createV1Database()
    runMigrations(migrated)
    const fresh = await createTestDatabase()
    runMigrations(fresh)

    expect(getUserVersion(migrated)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(migrated, fresh)).toEqual([])
  })

  it('既存の科目のid・名前・世帯メンバー・グループは保たれる', async () => {
    const db = await createV1Database()

    runMigrations(db)

    const food = new SqlJsAccountRepository(db).findById(1)
    expect(food).toMatchObject({ name: '食費', householdMemberId: 1, accountGroupId: 1, systemRole: null })
  })

  it('名前が一致する雑収入・雑損失と、費用のシステム管理科目(残高調整)に、システム管理と役割が付く', async () => {
    const db = await createV1Database()

    runMigrations(db)

    const repository = new SqlJsAccountRepository(db)
    expect(repository.findById(2)).toMatchObject({ isSystemManaged: true, systemRole: 'settlement_gain' })
    expect(repository.findById(3)).toMatchObject({ isSystemManaged: true, systemRole: 'settlement_loss' })
    expect(repository.findById(4)).toMatchObject({ isSystemManaged: true, systemRole: 'balance_adjustment', name: '帳簿の調整' })
  })

  it('一致する科目が無い(改名済み等)場合は役割を付けず、起動時のシードが新規に投入して3役割が揃う', async () => {
    const db = await createV1Database({ withRoleNames: false })

    runMigrations(db)
    expect(new SqlJsAccountRepository(db).findAll().filter((a) => a.systemRole !== null)).toHaveLength(0)
    seedBalanceAdjustmentAccount(db)
    seedSettlementAdjustmentAccounts(db)

    const roles = new SqlJsAccountRepository(db).findAll().map((a) => a.systemRole).filter((r) => r !== null)
    expect([...roles].sort()).toEqual(['balance_adjustment', 'settlement_gain', 'settlement_loss'])
  })

  it('差分のあとも、付与済みの役割は書き換えられず、同じ役割は2件作れない', async () => {
    const db = await createV1Database()
    runMigrations(db)

    expect(() => db.run('UPDATE accounts SET system_role = NULL WHERE id = 2')).toThrow()
    expect(() =>
      db.run(
        "INSERT INTO accounts (category, name, is_system_managed, system_role) VALUES ('revenue', '別の差益', 1, 'settlement_gain')",
      ),
    ).toThrow()
  })
})
