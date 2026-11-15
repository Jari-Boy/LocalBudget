import type { Database } from 'sql.js'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/** 自動調整仕訳(計画Issue #205)の相手科目となる、費用のシステム管理科目の名前 */
export const BALANCE_ADJUSTMENT_ACCOUNT_NAME = '残高調整'

/**
 * 自動調整仕訳の相手科目「残高調整」(expense・is_system_managed = true)をWorker起動時に1件だけ
 * 冪等に投入する(計画Issue #205、docs/domain/accounts.md 3.1)。システム管理科目は名前のみ変更できるため、
 * 判定は区分とis_system_managedの組で行い、expenseのシステム管理科目が既にあれば投入しない。
 */
export function seedBalanceAdjustmentAccount(db: Database): void {
  const repository = new SqlJsAccountRepository(db)
  const exists = repository
    .findAll()
    .some((account) => account.category === 'expense' && account.isSystemManaged)
  if (exists) return

  repository.create({
    category: 'expense',
    name: BALANCE_ADJUSTMENT_ACCOUNT_NAME,
    isReconcilable: null,
    isSystemManaged: true,
  })
}
