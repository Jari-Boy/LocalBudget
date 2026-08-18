/**
 * seedAdvanceAccounts の統合テスト(計画Issue #40、人間レビューでの追加指摘)。
 * docs/domain/expense-splitting.md 1.2節「科目自体は割勘のたびに新規作成しない。
 * 恒久的な汎用科目として1組だけ用意し、以降のすべての割勘で使い回す」を実現するため、
 * asset・liability区分それぞれについて、is_system_managed = trueの科目が1件も存在しない
 * 場合に「立替金」を1件自動投入すること、区分ごとに独立した冪等シードであることを、
 * seedDefaultAccounts・seedDefaultHouseholdMemberと同じ設計方針で検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { seedAdvanceAccounts } from './seedAdvanceAccounts'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

describe('seedAdvanceAccounts', () => {
  it('is_system_managedの資産・負債科目が0件の場合、立替金(資産)・立替金(負債)をそれぞれ1件ずつ投入する', () => {
    seedAdvanceAccounts(db)

    const accounts = repository.findAll()
    const advanceAsset = accounts.find((account) => account.category === 'asset' && account.isSystemManaged)
    const advanceLiability = accounts.find(
      (account) => account.category === 'liability' && account.isSystemManaged,
    )
    expect(advanceAsset).toMatchObject({ name: '立替金', isReconcilable: false, isSystemManaged: true })
    expect(advanceLiability).toMatchObject({ name: '立替金', isReconcilable: false, isSystemManaged: true })
  })

  it('通常のユーザー作成科目(is_system_managed = false)がいくつあっても、is_system_managedの立替金は独立して投入される', () => {
    repository.create({ category: 'asset', name: '現金', isReconcilable: false })
    repository.create({ category: 'liability', name: 'クレジットカード未払金', isReconcilable: false })

    seedAdvanceAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.filter((account) => account.category === 'asset' && account.isSystemManaged)).toHaveLength(1)
    expect(
      accounts.filter((account) => account.category === 'liability' && account.isSystemManaged),
    ).toHaveLength(1)
  })

  it('資産側だけ既に投入済みの場合、負債側のみ独立して投入される(区分ごとの独立判定)', () => {
    repository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })

    seedAdvanceAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.filter((account) => account.category === 'asset' && account.isSystemManaged)).toHaveLength(1)
    expect(
      accounts.filter((account) => account.category === 'liability' && account.isSystemManaged),
    ).toHaveLength(1)
  })

  it('2回連続で呼び出しても重複して投入されない(Worker起動のたびに呼ばれても冪等)', () => {
    seedAdvanceAccounts(db)
    seedAdvanceAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.filter((account) => account.isSystemManaged)).toHaveLength(2)
  })
})
