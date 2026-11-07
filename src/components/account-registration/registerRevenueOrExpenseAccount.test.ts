/**
 * 統合登録フロー・収益・費用サブフロー(docs/domain/accounts.md 4章、計画Issue #102)の
 * 確定処理のユニットテスト。AccountRepositoryのsql.js実装(Node上で動作)を用いて、
 * 収益・費用の科目が「カテゴリ選択→名前入力」の2ステップのみで、is_reconcilable = null
 * ・householdMemberId = null固定で作成されることを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { registerRevenueOrExpenseAccount } from './registerRevenueOrExpenseAccount'

let db: Database
let accountRepository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
})

describe('registerRevenueOrExpenseAccount', () => {
  it('収益科目を作成すると is_reconcilable = null で登録される', async () => {
    const account = await registerRevenueOrExpenseAccount(accountRepository, {
      category: 'revenue',
      name: '副業収入',
    })

    expect(account).toMatchObject({
      category: 'revenue',
      name: '副業収入',
      isReconcilable: null,
      householdMemberId: null,
    })
  })

  it('所属グループ(accountGroupId)を指定して作成できる(計画Issue #154)', async () => {
    const group = new SqlJsAccountGroupRepository(db).create({ name: '生活費', category: 'expense' })

    const account = await registerRevenueOrExpenseAccount(accountRepository, {
      category: 'expense',
      name: '食費',
      accountGroupId: group.id,
    })

    expect(account.accountGroupId).toBe(group.id)
  })

  it('費用科目を作成すると is_reconcilable = null で登録される', async () => {
    const account = await registerRevenueOrExpenseAccount(accountRepository, {
      category: 'expense',
      name: '娯楽費',
    })

    expect(account).toMatchObject({
      category: 'expense',
      name: '娯楽費',
      isReconcilable: null,
      householdMemberId: null,
    })
  })
})
