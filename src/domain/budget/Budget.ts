export interface Budget {
  id: number
  accountId: number
  yearMonth: string
  amount: number
  createdAt: string
  updatedAt: string
}

export interface CreateBudgetInput {
  accountId: number
  yearMonth: string
  amount: number
}

export interface UpdateBudgetInput {
  amount: number
}
