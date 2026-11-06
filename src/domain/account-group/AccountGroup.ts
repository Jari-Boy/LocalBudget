/**
 * 勘定科目グループの区分。accounts.categoryと同じ5区分。equityは、ユーザーが作成できない
 * システム管理科目(初期残高等)をグループ化するために許可する(計画Issue #143)。
 */
export type AccountGroupCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface AccountGroup {
  id: number
  name: string
  parentGroupId: number | null
  category: AccountGroupCategory
  /** 同じ入れ物(親グループ、最上位ならcategory)の中での表示順。他ノードとの重複可(計画Issue #129) */
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAccountGroupInput {
  name: string
  /** 作成時点で確定し、以後変更できない(計画Issue #129)。親子は常に同一categoryになる */
  category: AccountGroupCategory
  parentGroupId?: number | null
  sortOrder?: number
}

/** categoryは含まない: 作成後は変更できない(prevent_account_group_category_change) */
export interface UpdateAccountGroupInput {
  name?: string
  parentGroupId?: number | null
  sortOrder?: number
}
