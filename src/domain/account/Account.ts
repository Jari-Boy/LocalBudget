export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface Account {
  id: number
  category: AccountCategory
  name: string
  isReconcilable: boolean | null
  isActive: boolean
  isSystemManaged: boolean
  householdMemberId: number | null
  accountGroupId: number | null
  initialBalanceForAccountId: number | null
  createdAt: string
  updatedAt: string
}

export interface CreateAccountInput {
  category: AccountCategory
  name: string
  isReconcilable: boolean | null
  isSystemManaged?: boolean
  householdMemberId?: number | null
  accountGroupId?: number | null
  initialBalanceForAccountId?: number | null
}

export interface UpdateAccountInput {
  name?: string
  householdMemberId?: number | null
  accountGroupId?: number | null
}
