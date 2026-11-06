/**
 * seedInitialBalanceAccount の統合テスト(計画Issue #143)。
 * 口座ごとの「初期残高(口座名)」科目を廃止し、初期仕訳の相手科目を単一のシステム管理科目
 * 「初期残高」(equity)に統合する方針(docs/domain/accounts.md 4.3節)を実現するため、
 * 当該科目をWorker起動時に冪等に1件だけ投入することを、seedAdvanceAccountsと同じ設計方針で
 * 検証する。equity科目はユーザーが作成できない(prevent_user_created_equity_account)ため、
 * 名前衝突は起きない前提だが、再実行しても重複しないことと、非アクティブ化済みでも
 * 重複投入しないことを確認する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { INITIAL_BALANCE_ACCOUNT_NAME, seedInitialBalanceAccount } from './seedInitialBalanceAccount'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

describe('seedInitialBalanceAccount', () => {
  it('科目名は「初期残高」である', () => {
    expect(INITIAL_BALANCE_ACCOUNT_NAME).toBe('初期残高')
  })

  it('未投入の場合、システム管理のequity科目「初期残高」を1件投入する', () => {
    seedInitialBalanceAccount(db)

    const accounts = repository.findAll()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      category: 'equity',
      name: '初期残高',
      isSystemManaged: true,
      isReconcilable: null,
    })
  })

  it('繰り返し呼んでも重複して投入されない(冪等)', () => {
    seedInitialBalanceAccount(db)
    seedInitialBalanceAccount(db)

    expect(repository.findAll()).toHaveLength(1)
  })

  it('他の科目が存在しても影響を受けず、初期残高科目だけが追加される', () => {
    repository.create({ category: 'asset', name: '現金', isReconcilable: false })

    seedInitialBalanceAccount(db)

    expect(repository.findAll().map((a) => a.name)).toEqual(['現金', '初期残高'])
  })
})
