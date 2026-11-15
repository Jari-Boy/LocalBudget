import type { AnchorRow } from './planBalanceAnchorAdjustments'

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

/** 残高の照合欄が読む、科目の照合表(計画Issue #205) */
export interface AccountReconciliation {
  /** 取引後残高のあるCSVの基準点を持つか。持つ科目は残高を手で記録しない(CSVのみ) */
  usesStatement: boolean
  autoAdjust: boolean
  /** 基準点の日付順。最初の行が元手(初期残高) */
  rows: AnchorRow[]
}

/** 残高を記録する前に見せる、その日の帳簿残高と記録すると入る調整額 */
export interface BalanceRecordPreview {
  /** 記録日時点の帳簿残高(その日までの自動調整を含まない明細の合計、元手が入る前の値) */
  bookBalance: number
  /** 記録すると入る調整額(符号付き、残高が増える向きが正)。0なら調整は入らない */
  adjustment: number
}
