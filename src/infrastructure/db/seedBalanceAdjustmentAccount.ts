import type { Database } from 'sql.js'
import { ensureSystemRoleAccount } from './ensureSystemRoleAccount'

/** 自動調整仕訳(計画Issue #205)の相手科目となる、費用のシステム管理科目の既定名 */
export const BALANCE_ADJUSTMENT_ACCOUNT_NAME = '残高調整'

/**
 * 自動調整仕訳の相手科目「残高調整」(expense・is_system_managed = true・役割balance_adjustment)を
 * Worker起動時に1件だけ冪等に投入する(計画Issue #205、docs/domain/accounts.md 3.1)。
 * 判定は名前でも「費用のシステム管理科目があるか」でもなく役割で行う(計画Issue #223)。雑損失など
 * 費用のシステム管理科目が他にあっても投入され、改名されても再投入されない。役割の無い旧データの
 * 費用のシステム管理科目(これまでは残高調整だけだった)には、新規に投入せず役割を付与する。
 */
export function seedBalanceAdjustmentAccount(db: Database): void {
  ensureSystemRoleAccount(db, {
    role: 'balance_adjustment',
    category: 'expense',
    name: BALANCE_ADJUSTMENT_ACCOUNT_NAME,
    isLegacyCandidate: (account) => account.isSystemManaged,
  })
}
