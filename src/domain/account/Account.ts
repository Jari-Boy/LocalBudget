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
  /** 所属グループ内での表示順(未分類の場合は意味を持たない、計画Issue #129) */
  sortOrder: number
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
  sortOrder?: number
}

export interface UpdateAccountInput {
  name?: string
  householdMemberId?: number | null
  accountGroupId?: number | null
  sortOrder?: number
}
