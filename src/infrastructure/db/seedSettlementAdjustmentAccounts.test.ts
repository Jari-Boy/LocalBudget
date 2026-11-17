/**
 * seedSettlementAdjustmentAccounts の統合テスト(計画Issue #139、役割方式への変更は計画Issue #223)。
 * 精算画面で金額不一致を損益計上して精算完了する操作のために、差額計上先の「雑収入」(revenue、
 * 役割 settlement_gain)・「雑損失」(expense、役割 settlement_loss)をシステム管理科目として
 * 自動投入することを検証する。科目は名前ではなく役割で識別するので、改名されても再投入されず、
 * 役割の付いていない既存の同名科目(旧データ)にはシステム管理と役割を付与する。
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
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedDefaultAccounts } from './seedDefaultAccounts'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

const byRole = (role: string) => repository.findAll().filter((a) => a.systemRole === role)

describe('seedSettlementAdjustmentAccounts', () => {
  it('科目が無い場合、雑収入(revenue)・雑損失(expense)をシステム管理科目として役割付きで1件ずつ投入する', () => {
    seedSettlementAdjustmentAccounts(db)

    expect(byRole('settlement_gain')).toEqual([
      expect.objectContaining({
        name: SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME,
        category: 'revenue',
        isSystemManaged: true,
      }),
    ])
    expect(byRole('settlement_loss')).toEqual([
      expect.objectContaining({
        name: SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME,
        category: 'expense',
        isSystemManaged: true,
      }),
    ])
  })

  it('revenue・expense区分に他の標準科目が既に存在していても、役割で個別に判定して投入する(seedDefaultAccountsとの併用)', () => {
    seedDefaultAccounts(db)

    seedSettlementAdjustmentAccounts(db)

    expect(byRole('settlement_gain')).toHaveLength(1)
    expect(byRole('settlement_loss')).toHaveLength(1)
  })

  it('再度呼んでも重複して投入しない(冪等)', () => {
    seedSettlementAdjustmentAccounts(db)
    seedSettlementAdjustmentAccounts(db)

    expect(repository.findAll()).toHaveLength(2)
  })

  it('投入後に名前を変えても、次回呼び出しで科目が増えない(役割で識別する)', () => {
    seedSettlementAdjustmentAccounts(db)
    const gain = byRole('settlement_gain')[0]
    repository.update(gain.id, { name: 'その他の収入' })

    seedSettlementAdjustmentAccounts(db)

    expect(byRole('settlement_gain')).toHaveLength(1)
    expect(repository.findAll().filter((a) => a.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)).toHaveLength(0)
  })

  it('役割の付いていない既存の同名の通常科目(旧データ)は、新規投入せずシステム管理と役割を付与する', () => {
    const legacyGain = repository.create({ category: 'revenue', name: '雑収入', isReconcilable: null })
    const legacyLoss = repository.create({ category: 'expense', name: '雑損失', isReconcilable: null })

    seedSettlementAdjustmentAccounts(db)

    expect(repository.findAll()).toHaveLength(2)
    expect(repository.findById(legacyGain.id)).toMatchObject({ isSystemManaged: true, systemRole: 'settlement_gain' })
    expect(repository.findById(legacyLoss.id)).toMatchObject({ isSystemManaged: true, systemRole: 'settlement_loss' })
  })

  it('旧データの科目に過去の仕訳・世帯メンバー・グループが紐づいていても、そのまま役割だけが付く', () => {
    const member = db
      .exec("INSERT INTO household_members (name) VALUES ('自分') RETURNING id")[0]
      .values[0][0] as number
    const legacyGain = repository.create({
      category: 'revenue',
      name: '雑収入',
      isReconcilable: null,
      householdMemberId: member,
      sortOrder: 7,
    })

    seedSettlementAdjustmentAccounts(db)

    expect(repository.findById(legacyGain.id)).toMatchObject({
      systemRole: 'settlement_gain',
      householdMemberId: member,
      sortOrder: 7,
    })
  })

  it('同名の科目が非アクティブだけの場合は、それに触れず新しい科目を投入する', () => {
    const inactive = repository.create({ category: 'expense', name: '雑損失', isReconcilable: null })
    repository.deactivate(inactive.id)

    seedSettlementAdjustmentAccounts(db)

    expect(repository.findById(inactive.id)).toMatchObject({ isActive: false, systemRole: null })
    expect(byRole('settlement_loss')).toHaveLength(1)
    expect(byRole('settlement_loss')[0].id).not.toBe(inactive.id)
  })

  it('「残高調整」と共存でき、お互いの科目を取り違えない(どちらも費用のシステム管理科目)', () => {
    seedBalanceAdjustmentAccount(db)
    seedSettlementAdjustmentAccounts(db)

    const adjustment = byRole('balance_adjustment')
    const loss = byRole('settlement_loss')
    expect(adjustment).toHaveLength(1)
    expect(loss).toHaveLength(1)
    expect(adjustment[0].id).not.toBe(loss[0].id)
  })
})
