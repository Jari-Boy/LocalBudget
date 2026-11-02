/**
 * 精算バッチの種別(計画Issue #133)。'expense_splitting'は割勘、'installment'は分割払い。
 * 列挙値は現時点で判明しているユースケースのみ。将来増える可能性があるため実装時に調整してよい
 * (docs/domain/settlement.md参照)。
 */
export type SettlementBatchType = 'expense_splitting' | 'installment'

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
  counterpartyId?: number | null
}
