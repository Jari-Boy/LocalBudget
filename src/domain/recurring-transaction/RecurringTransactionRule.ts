export type RecurringTransactionFrequency = 'weekly' | 'monthly' | 'yearly'

/** 土日の調整(計画Issue #164)。none=そのまま、next=翌平日、previous=前平日。祝日は扱わない */
export type WeekendAdjustment = 'none' | 'next' | 'previous'

/** 確認パネルの金額の初期値(計画Issue #164)。fixed=ルールの金額、last_confirmed=前回確定した金額 */
export type RecurringAmountMode = 'fixed' | 'last_confirmed'

export interface RecurringTransactionRule {
  id: number
  name: string
  debitAccountId: number
  creditAccountId: number
  amount: number
  frequency: RecurringTransactionFrequency
  dayOfWeek: number | null
  dayOfMonth: number | null
  weekOfMonth: number | null
  monthOfYear: number | null
  projectId: number | null
  householdMemberId: number | null
  counterpartyId: number | null
  maxOccurrences: number | null
  /** 開始日(YYYY-MM-DD、当日を含む)。周期の基準を兼ねる(計画Issue #164) */
  startsOn: string
  /** 終了日(YYYY-MM-DD、当日を含む)。任意。回数の上限と両方あれば先に来たほうで止まる */
  endsOn: string | null
  /** N回ごと(1以上)。毎週・毎月・毎年のそれぞれに適用する。周期の基準は開始日 */
  interval: number
  weekendAdjustment: WeekendAdjustment
  amountMode: RecurringAmountMode
  /** 再有効化の再開日(YYYY-MM-DD、当日を含む)。一度も再有効化していなければnull。開始日とは別の列 */
  resumedOn: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateRecurringTransactionRuleInput {
  name: string
  debitAccountId: number
  creditAccountId: number
  amount: number
  frequency: RecurringTransactionFrequency
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  monthOfYear?: number | null
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  maxOccurrences?: number | null
  startsOn?: string
  endsOn?: string | null
  interval?: number
  weekendAdjustment?: WeekendAdjustment
  amountMode?: RecurringAmountMode
}

export interface UpdateRecurringTransactionRuleInput {
  name: string
  debitAccountId: number
  creditAccountId: number
  amount: number
  frequency: RecurringTransactionFrequency
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  monthOfYear?: number | null
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  maxOccurrences?: number | null
  startsOn?: string
  endsOn?: string | null
  interval?: number
  weekendAdjustment?: WeekendAdjustment
  amountMode?: RecurringAmountMode
}
