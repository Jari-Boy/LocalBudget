import type { Database } from 'sql.js'
import { ensureSystemRoleAccount } from './ensureSystemRoleAccount'

/** 精算画面(計画Issue #139)が差額計上(資産側の過不足)に使う収益科目の既定名 */
export const SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME = '雑収入'
/** 精算画面(計画Issue #139)が差額計上(負債側の過不足)に使う費用科目の既定名 */
export const SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME = '雑損失'

/**
 * 精算画面(計画Issue #139)の「金額不一致時に差額を損益計上して精算完了する」操作のために、
 * 差額計上先の「雑収入」(revenue・役割settlement_gain)・「雑損失」(expense・役割settlement_loss)を
 * システム管理科目として自動投入する(計画Issue #223)。科目は名前ではなく役割(system_role)で識別するため、
 * 利用者が改名しても精算は動き、再投入もされない。削除・統合・区分変更はできない。
 * 役割の無い旧データの同名科目(通常科目だったもの)には、新規に投入せずシステム管理と役割を付与する。
 * Worker起動のたびに呼ばれても冪等であり、db.worker.tsからseedBalanceAdjustmentAccountの後に呼び出す。
 */
export function seedSettlementAdjustmentAccounts(db: Database): void {
  ensureSystemRoleAccount(db, {
    role: 'settlement_gain',
    category: 'revenue',
    name: SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME,
    isLegacyCandidate: (account) => account.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME && !account.isSystemManaged,
  })
  ensureSystemRoleAccount(db, {
    role: 'settlement_loss',
    category: 'expense',
    name: SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME,
    isLegacyCandidate: (account) => account.name === SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME && !account.isSystemManaged,
  })
}
