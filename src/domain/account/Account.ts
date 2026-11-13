export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface Account {
  id: number
  category: AccountCategory
  name: string
  isReconcilable: boolean | null
  /**
   * 登録時の「外部明細(CSV)はありますか?」の回答(計画Issue #189)。資産・負債はtrue/false、
   * それ以外はnull。isReconcilableがfalseでは「外部明細あり・残高なし」と「なし」を区別できないため、
   * 回答そのものを保存する。作成後は変更しない。資産・負債でnullなのは回答を保存する前に作られた行
   * (未記録)だけで、その場合はisReconcilableから推定する(resolveHasExternalStatement)
   */
  hasExternalStatement: boolean | null
  isActive: boolean
  isSystemManaged: boolean
  householdMemberId: number | null
  accountGroupId: number | null
  /** 所属グループ内での表示順(未分類の場合は意味を持たない、計画Issue #129) */
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateAccountInput {
  category: AccountCategory
  name: string
  isReconcilable: boolean | null
  /**
   * 外部明細の有無(登録時の回答)。省略した資産・負債は、isReconcilableがtrueなら外部明細あり、
   * それ以外はなしとみなす(CSVあり・残高なしの科目は明示して渡す)。収益・費用等はnull
   */
  hasExternalStatement?: boolean | null
  isSystemManaged?: boolean
  householdMemberId?: number | null
  accountGroupId?: number | null
  sortOrder?: number
}

/** 科目の更新時のオプション */
export interface UpdateAccountOptions {
  /**
   * trueのとき、既定の世帯メンバーを非nullに変える更新と同時に、この科目の過去の明細行の世帯メンバーも
   * 新しい既定メンバーに更新する(設定ミスの修正向け)。falseまたは未指定なら、過去の明細行は旧メンバーの
   * まま残る(名義が実際に変わった場合や、既定の新規設定向け。計画Issue #169)。既定メンバーを解除する
   * (null)更新では、明細行は変わらない
   */
  updateExistingLines?: boolean
}

export interface UpdateAccountInput {
  name?: string
  householdMemberId?: number | null
  accountGroupId?: number | null
  sortOrder?: number
}
