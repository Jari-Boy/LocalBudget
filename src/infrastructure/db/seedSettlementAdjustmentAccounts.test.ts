/**
 * seedSettlementAdjustmentAccounts の統合テスト(計画Issue #139)。
 * 精算画面で金額不一致を損益計上して精算完了する操作のために、差額計上先の「雑収入」(revenue)・
 * 「雑損失」(expense)科目を名前の有無で判定して自動投入することを検証する。seedDefaultAccountsの
 * ような「区分に1件でもあればスキップ」ではなく、名前で個別に判定する(seedAdvanceAccountsと同じ
 * 考え方。区分に他の標準科目が既に存在する状況でも確実に存在させる必要があるため)。
 * 投入される科目はis_system_managed = false(ユーザーが自由に変更・削除できる通常科目)。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import {
  seedSettlementAdjustmentAccounts,
  SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME,
  SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME,
} from './seedSettlementAdjustmentAccounts'
import { seedDefaultAccounts } from './seedDefaultAccounts'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

describe('seedSettlementAdjustmentAccounts', () => {
  it('雑収入(revenue)・雑損失(expense)科目が存在しない場合、それぞれ1件ずつ投入する', () => {
    seedSettlementAdjustmentAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.find((a) => a.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)).toMatchObject({
      category: 'revenue',
      isSystemManaged: false,
    })
    expect(accounts.find((a) => a.name === SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME)).toMatchObject({
      category: 'expense',
      isSystemManaged: false,
    })
  })

  it('revenue・expense区分に他の標準科目が既に存在していても、名前で個別に判定して投入する(seedDefaultAccountsとの併用)', () => {
    seedDefaultAccounts(db)

    seedSettlementAdjustmentAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.filter((a) => a.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)).toHaveLength(1)
    expect(accounts.filter((a) => a.name === SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME)).toHaveLength(1)
  })

  it('同名の科目が既に存在する場合は再投入しない(冪等)', () => {
    seedSettlementAdjustmentAccounts(db)
    seedSettlementAdjustmentAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.filter((a) => a.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)).toHaveLength(1)
    expect(accounts.filter((a) => a.name === SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME)).toHaveLength(1)
  })

  it('投入後にユーザーが削除した場合、次回呼び出しで再度投入される(is_system_managedではないため削除可能)', () => {
    seedSettlementAdjustmentAccounts(db)
    const gain = repository.findAll().find((a) => a.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)!
    repository.delete(gain.id)

    seedSettlementAdjustmentAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.filter((a) => a.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)).toHaveLength(1)
  })
})
