import type { JournalLineSide } from '../journal/JournalEntry'

export type RecurringTransactionFrequency = 'weekly' | 'monthly' | 'yearly'

/** 土日の調整(計画Issue #164)。none=そのまま、next=翌平日、previous=前平日。祝日は扱わない */
export type WeekendAdjustment = 'none' | 'next' | 'previous'

/** 確認パネルの金額の初期値(計画Issue #164)。fixed=ルールの金額、last_confirmed=前回確定した金額 */
export type RecurringAmountMode = 'fixed' | 'last_confirmed'

/**
 * ルールの行(recurring_transaction_rule_lines、計画Issue #180)。仕訳の明細行のひな形で、
 * 2行のルールも3行以上のルールも同じ形で表す。行の並びはlineNo(1始まり)で決まる
 */
export interface RecurringTransactionRuleLine {
  /** 行番号(1始まり)。ルール内で一意 */
  lineNo: number
  side: JournalLineSide
  accountId: number
  /** 通貨最小単位の正の整数。確認パネルの初期値(金額の初期値が固定のとき) */
  amount: number
  projectId: number | null
  /** 行の世帯メンバー。null=行では決めない(科目の既定メンバー > 起票者の順で決まる) */
  householdMemberId: number | null
  /** PL区分(収益・費用)の科目の行にだけ設定できる(DBのTRIGGERで強制) */
  counterpartyId: number | null
  /** 精算バッチ。システム管理の立替金・未払金の科目の行にだけ設定できる */
  settlementBatchId: number | null
}

/** ルールの行の入力。行番号は入力順(1始まり)で振られる */
export interface RecurringTransactionRuleLineInput {
  side: JournalLineSide
  accountId: number
  amount: number
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  settlementBatchId?: number | null
}

export interface RecurringTransactionRule {
  id: number
  name: string
  /** 起票者(ルール単位、計画Issue #180)。null=確定時に選ぶ。行の世帯メンバーとは別の概念 */
  bookkeeperHouseholdMemberId: number | null
  /** 行番号の昇順。貸借が一致する(保存時に仕訳と同じ検証で強制) */
  lines: RecurringTransactionRuleLine[]
  frequency: RecurringTransactionFrequency
  dayOfWeek: number | null
  dayOfMonth: number | null
  weekOfMonth: number | null
  monthOfYear: number | null
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
  bookkeeperHouseholdMemberId?: number | null
  lines: RecurringTransactionRuleLineInput[]
  frequency: RecurringTransactionFrequency
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  monthOfYear?: number | null
  maxOccurrences?: number | null
  startsOn?: string
  endsOn?: string | null
  interval?: number
  weekendAdjustment?: WeekendAdjustment
  amountMode?: RecurringAmountMode
}

export type UpdateRecurringTransactionRuleInput = CreateRecurringTransactionRuleInput
