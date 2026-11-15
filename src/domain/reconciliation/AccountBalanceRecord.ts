/**
 * 手で記録した残高(基準点、計画Issue #205、docs/domain/reconciliation.md 1.5)。
 * recordDate の終わり時点の正しい残高を表す。
 */
export interface AccountBalanceRecord {
  id: number
  accountId: number
  recordDate: string
  balance: number
  createdAt: string
  updatedAt: string
}

export interface CreateAccountBalanceRecordInput {
  accountId: number
  recordDate: string
  balance: number
}

export interface UpdateAccountBalanceRecordInput {
  recordDate: string
  balance: number
}
