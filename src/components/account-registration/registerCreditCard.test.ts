/**
 * クレジットカード登録ウィザードの確定処理(docs/domain/accounts.md 5章)のユニットテスト。
 * AccountRepositoryのsql.js実装(Node上で動作)を用いて、category = 'liability'・
 * is_reconcilable = false固定の負債科目が作成されることを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { registerCreditCard } from './registerCreditCard'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
})

describe('registerCreditCard', () => {
  it('負債科目(is_reconcilable = false固定)が作成される', async () => {
    const account = await registerCreditCard(accountRepository, {
      name: '楽天カード',
      householdMemberId: null,
    })

    expect(account).toMatchObject({
      category: 'liability',
      name: '楽天カード',
      isReconcilable: false,
    })
  })

  it('名義(householdMemberId)を指定して作成できる', async () => {
    const member = householdMemberRepository.create({ name: '花子' })

    const account = await registerCreditCard(accountRepository, {
      name: '楽天カード',
      householdMemberId: member.id,
    })

    expect(account.householdMemberId).toBe(member.id)
  })
})
