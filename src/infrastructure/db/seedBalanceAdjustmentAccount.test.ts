/**
 * seedBalanceAdjustmentAccount の統合テスト(計画Issue #205、役割方式への変更は計画Issue #223)。
 * 自動調整仕訳の相手科目「残高調整」(expense・システム管理・役割 balance_adjustment)を
 * Worker起動時に1件だけ冪等に投入することを検証する。判定は名前でも「費用のシステム管理科目が
 * あるか」でもなく役割で行うため、雑損失(同じく費用のシステム管理科目)が先にあっても投入され、
 * 改名されても再投入されない。役割の無い旧データの費用のシステム管理科目には役割を付与する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { BALANCE_ADJUSTMENT_ACCOUNT_NAME, seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedSettlementAdjustmentAccounts } from './seedSettlementAdjustmentAccounts'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

const byRole = (role: string) => repository.findAll().filter((a) => a.systemRole === role)

describe('seedBalanceAdjustmentAccount', () => {
  it('科目が無い場合、費用のシステム管理科目「残高調整」を役割付きで1件投入する', () => {
    seedBalanceAdjustmentAccount(db)

    expect(byRole('balance_adjustment')).toEqual([
      expect.objectContaining({ name: BALANCE_ADJUSTMENT_ACCOUNT_NAME, category: 'expense', isSystemManaged: true }),
    ])
  })

  it('再度呼んでも重複して投入しない(冪等)', () => {
    seedBalanceAdjustmentAccount(db)
    seedBalanceAdjustmentAccount(db)

    expect(repository.findAll()).toHaveLength(1)
  })

  it('投入後に名前を変えても、次回呼び出しで科目が増えない', () => {
    seedBalanceAdjustmentAccount(db)
    repository.update(byRole('balance_adjustment')[0].id, { name: '帳簿の調整' })

    seedBalanceAdjustmentAccount(db)

    expect(repository.findAll()).toHaveLength(1)
  })

  it('雑損失(費用のシステム管理科目)が先に投入されていても、残高調整は別に投入される', () => {
    seedSettlementAdjustmentAccounts(db)

    seedBalanceAdjustmentAccount(db)

    expect(byRole('balance_adjustment')).toHaveLength(1)
    expect(byRole('settlement_loss')).toHaveLength(1)
  })

  it('役割の無い旧データの費用のシステム管理科目(改名済みの残高調整)には、新規投入せず役割を付与する', () => {
    const legacy = repository.create({
      category: 'expense',
      name: '帳簿の調整',
      isReconcilable: null,
      isSystemManaged: true,
    })

    seedBalanceAdjustmentAccount(db)

    expect(repository.findAll()).toHaveLength(1)
    expect(repository.findById(legacy.id)?.systemRole).toBe('balance_adjustment')
  })
})
