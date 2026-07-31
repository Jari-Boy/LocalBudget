export interface Counterparty {
  id: number
  name: string
  defaultAccountId: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCounterpartyInput {
  name: string
  defaultAccountId?: number
}

export interface UpdateCounterpartyInput {
  name?: string
  defaultAccountId?: number | null
}

export interface CounterpartyPattern {
  id: number
  counterpartyId: number
  pattern: string
  createdAt: string
}
