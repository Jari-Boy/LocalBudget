/**
 * 「その他の科目を追加する」フォーム(計画Issue #95)の確定処理のユニットテスト。
 * 資産・負債・収益・費用の科目を、区分に応じてis_reconcilableを正しく決定した上で
 * 作成できることを、AccountRepositoryのsql.js実装(Node上で動作)を用いて検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { registerOtherAccount } from './registerOtherAccount'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
})

describe('registerOtherAccount', () => {
  it('資産科目を「突合する」回答で作成すると is_reconcilable = true になる', async () => {
    const account = await registerOtherAccount(accountRepository, {
      category: 'asset',
      name: '未収金',
      householdMemberId: null,
      reconciliationAnswer: 'matches_external_statement',
    })

    expect(account).toMatchObject({
      category: 'asset',
      name: '未収金',
      isReconcilable: true,
    })
  })

  it('資産科目を「突合しない」回答で作成すると is_reconcilable = false になる', async () => {
    const account = await registerOtherAccount(accountRepository, {
      category: 'asset',
      name: '未収金',
      householdMemberId: null,
      reconciliationAnswer: 'manual_only',
    })

    expect(account.isReconcilable).toBe(false)
  })

  it('負債科目を「突合しない」回答で作成すると is_reconcilable = false になる', async () => {
    const account = await registerOtherAccount(accountRepository, {
      category: 'liability',
      name: 'ローン',
      householdMemberId: null,
      reconciliationAnswer: 'manual_only',
    })

    expect(account).toMatchObject({
      category: 'liability',
      isReconcilable: false,
    })
  })

  it('収益科目を作成すると is_reconcilable は常にnullになる(設問回答は無視される)', async () => {
    const account = await registerOtherAccount(accountRepository, {
      category: 'revenue',
      name: '副業収入',
      householdMemberId: null,
    })

    expect(account).toMatchObject({
      category: 'revenue',
      isReconcilable: null,
    })
  })

  it('費用科目を作成すると is_reconcilable は常にnullになる', async () => {
    const account = await registerOtherAccount(accountRepository, {
      category: 'expense',
      name: '娯楽費',
      householdMemberId: null,
    })

    expect(account.isReconcilable).toBeNull()
  })

  it('名義(householdMemberId)を指定して作成できる', async () => {
    const member = householdMemberRepository.create({ name: '花子' })

    const account = await registerOtherAccount(accountRepository, {
      category: 'expense',
      name: '娯楽費',
      householdMemberId: member.id,
    })

    expect(account.householdMemberId).toBe(member.id)
  })
})
