/**
 * 精算バッチの種別(計画Issue #133)。'expense_splitting'(割勘)のみ。分割払い('installment')は
 * 精算バッチの対象を立替金・未払金に絞った際に廃止した(計画Issue #167、docs/domain/settlement.md参照)。
 */
export type SettlementBatchType = 'expense_splitting'

export interface SettlementBatch {
  id: number
  name: string
  type: SettlementBatchType
  /** 世帯外の相手との割勘バッチにのみ設定する。世帯メンバー間のバッチはnull */
  counterpartyId: number | null
  createdAt: string
  updatedAt: string
}

export interface CreateSettlementBatchInput {
  name: string
  type: SettlementBatchType
  counterpartyId?: number | null
}

export interface UpdateSettlementBatchInput {
  /** バッチ名の変更(計画Issue #153の精算タブ)。省略時は変えない */
  name?: string
  counterpartyId?: number | null
}
