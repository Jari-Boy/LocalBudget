export interface Counterparty {
  id: number
  name: string
  defaultAccountId: number | null
  /** 所属グループ。nullは未分類(CSV取込で作られた取引先の既定、計画Issue #143) */
  counterpartyGroupId: number | null
  /** 所属グループ内(未分類なら全体)での表示順。表示専用 */
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCounterpartyInput {
  name: string
  defaultAccountId?: number
  counterpartyGroupId?: number | null
  sortOrder?: number
}

export interface UpdateCounterpartyInput {
  name?: string
  defaultAccountId?: number | null
  counterpartyGroupId?: number | null
  sortOrder?: number
}

export interface CounterpartyPattern {
  id: number
  counterpartyId: number
  pattern: string
  createdAt: string
}
