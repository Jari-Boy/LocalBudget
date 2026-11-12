import type {
  CreateRecurringTransactionRuleInput,
  RecurringAmountMode,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
  WeekendAdjustment,
} from '../../domain/recurring-transaction/RecurringTransactionRule'

/**
 * マスタ画面の定期取引ルールのフォーム入力と、Repository送信用の入力への変換(計画Issue #154)。
 * 旧・定期取引ルール管理画面(計画Issue #39)の内部関数を、純粋関数として取り出したもの。
 */

export type MonthlyMode = 'dayOfMonth' | 'weekday'

export interface RuleForm {
  name: string
  debitAccountId: number | ''
  creditAccountId: number | ''
  amount: string
  frequency: RecurringTransactionFrequency
  monthlyMode: MonthlyMode
  dayOfWeek: number | ''
  dayOfMonth: number | ''
  weekOfMonth: number | ''
  monthOfYear: number | ''
  projectId: number | ''
  householdMemberId: number | ''
  counterpartyId: number | ''
  maxOccurrences: string
  /** 開始日(YYYY-MM-DD)。必須。周期の基準を兼ねる(計画Issue #164) */
  startsOn: string
  /** 終了日(YYYY-MM-DD)。空は終了なし */
  endsOn: string
  /** N回ごと。1以上の整数 */
  interval: string
  weekendAdjustment: WeekendAdjustment
  amountMode: RecurringAmountMode
}

/** 空のフォーム。開始日の既定は今日(過去日も指定できる) */
export function emptyRuleForm(today: string = new Date().toISOString().slice(0, 10)): RuleForm {
  return {
    name: '',
    debitAccountId: '',
    creditAccountId: '',
    amount: '',
    frequency: 'monthly',
    monthlyMode: 'dayOfMonth',
    dayOfWeek: '',
    dayOfMonth: '',
    weekOfMonth: '',
    monthOfYear: '',
    projectId: '',
    householdMemberId: '',
    counterpartyId: '',
    maxOccurrences: '',
    startsOn: today,
    endsOn: '',
    interval: '1',
    weekendAdjustment: 'none',
    amountMode: 'fixed',
  }
}

/**
 * ルールからフォームを復元する。このフォームは「借方1・貸方1」の2行のルールを編集する形で、
 * 3行以上のルールの編集は行編集の共通部品に置き換える際に扱う(計画Issue #180)。
 * 借方・貸方の科目と金額は最初の借方・貸方の行から、プロジェクト・取引先は行の最初の設定値から取り出す。
 * フォームの「起票者」はルール単位の起票者(bookkeeperHouseholdMemberId)
 */
export function ruleFormFromRule(rule: RecurringTransactionRule): RuleForm {
  const debit = rule.lines.find((l) => l.side === 'debit')
  const credit = rule.lines.find((l) => l.side === 'credit')
  return {
    name: rule.name,
    debitAccountId: debit?.accountId ?? '',
    creditAccountId: credit?.accountId ?? '',
    amount: String(debit?.amount ?? ''),
    frequency: rule.frequency,
    monthlyMode: rule.dayOfMonth !== null && rule.frequency === 'monthly' ? 'dayOfMonth' : 'weekday',
    dayOfWeek: rule.dayOfWeek ?? '',
    dayOfMonth: rule.dayOfMonth ?? '',
    weekOfMonth: rule.weekOfMonth ?? '',
    monthOfYear: rule.monthOfYear ?? '',
    projectId: rule.lines.find((l) => l.projectId !== null)?.projectId ?? '',
    householdMemberId: rule.bookkeeperHouseholdMemberId ?? '',
    counterpartyId: rule.lines.find((l) => l.counterpartyId !== null)?.counterpartyId ?? '',
    maxOccurrences: rule.maxOccurrences === null ? '' : String(rule.maxOccurrences),
    startsOn: rule.startsOn,
    endsOn: rule.endsOn ?? '',
    interval: String(rule.interval),
    weekendAdjustment: rule.weekendAdjustment,
    amountMode: rule.amountMode,
  }
}

const orNull = (value: number | ''): number | null => (value === '' ? null : value)

/**
 * 繰り返しごとに使うカラムの組み合わせ(docs/domain/recurring-transactions.md 1.3)を組み立てる。
 * 使わないカラムは必ずnullにする(assertValidRecurringScheduleが検証する4パターンに従う)。
 */
function scheduleColumns(form: RuleForm) {
  const none = { dayOfWeek: null, dayOfMonth: null, weekOfMonth: null, monthOfYear: null }
  switch (form.frequency) {
    case 'weekly':
      return { ...none, dayOfWeek: orNull(form.dayOfWeek) }
    case 'monthly':
      return form.monthlyMode === 'dayOfMonth'
        ? { ...none, dayOfMonth: orNull(form.dayOfMonth) }
        : { ...none, dayOfWeek: orNull(form.dayOfWeek), weekOfMonth: orNull(form.weekOfMonth) }
    case 'yearly':
      return { ...none, dayOfMonth: orNull(form.dayOfMonth), monthOfYear: orNull(form.monthOfYear) }
  }
}

/** 回数の上限: 空はnull(上限なし)、それ以外は数値に変換する(妥当性はisRuleFormValidで確認する) */
function parseMaxOccurrences(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/**
 * フォーム入力からRepository送信用の入力を組み立てる。呼び出し前にisRuleFormValidで確認する。
 * 借方・貸方の2行を作り、プロジェクトは両行に、取引先はPL区分(収益・費用)の行にだけ設定する
 * (isPlAccountで判定。借方が先。DBが取引先をPL科目以外の行に置くことを拒否するため)。
 * 行の世帯メンバーは指定せず(科目の既定 > 起票者で決まる)、起票者はルール単位に保存する
 */
export function buildRuleInput(
  form: RuleForm,
  isPlAccount: (accountId: number) => boolean = () => false,
): CreateRecurringTransactionRuleInput {
  const debitAccountId = form.debitAccountId as number
  const creditAccountId = form.creditAccountId as number
  const counterpartyId = orNull(form.counterpartyId)
  const counterpartyOnDebit = isPlAccount(debitAccountId)
  const counterpartyOnCredit = !counterpartyOnDebit && isPlAccount(creditAccountId)
  const amount = Number(form.amount)
  const projectId = orNull(form.projectId)
  return {
    name: form.name.trim(),
    bookkeeperHouseholdMemberId: orNull(form.householdMemberId),
    lines: [
      { side: 'debit', accountId: debitAccountId, amount, projectId, counterpartyId: counterpartyOnDebit ? counterpartyId : null },
      { side: 'credit', accountId: creditAccountId, amount, projectId, counterpartyId: counterpartyOnCredit ? counterpartyId : null },
    ],
    frequency: form.frequency,
    ...scheduleColumns(form),
    maxOccurrences: parseMaxOccurrences(form.maxOccurrences),
    startsOn: form.startsOn,
    endsOn: form.endsOn === '' ? null : form.endsOn,
    interval: Number(form.interval),
    weekendAdjustment: form.weekendAdjustment,
    amountMode: form.amountMode,
  }
}

/**
 * スケジュールの入力が揃っているか(計画Issue #164)。繰り返しごとに必要な項目、回数の上限(空か正の整数)、
 * 開始日(必須)、終了日(空か開始日以後)、間隔(1以上の整数)。期日のプレビューを出せる条件でもある
 */
export function isScheduleFormValid(form: RuleForm): boolean {
  const max = parseMaxOccurrences(form.maxOccurrences)
  if (max !== null && (!Number.isInteger(max) || max <= 0)) return false

  const interval = Number(form.interval)
  if (form.interval.trim() === '' || !Number.isInteger(interval) || interval < 1) return false
  if (form.startsOn === '') return false
  if (form.endsOn !== '' && form.endsOn < form.startsOn) return false

  const schedule = scheduleColumns(form)
  switch (form.frequency) {
    case 'weekly':
      return schedule.dayOfWeek !== null
    case 'monthly':
      return form.monthlyMode === 'dayOfMonth'
        ? schedule.dayOfMonth !== null
        : schedule.dayOfWeek !== null && schedule.weekOfMonth !== null
    case 'yearly':
      return schedule.dayOfMonth !== null && schedule.monthOfYear !== null
  }
}

/** 必須項目(名称・科目・金額)と、スケジュールの入力(isScheduleFormValid)が揃っているか */
export function isRuleFormValid(form: RuleForm): boolean {
  if (form.name.trim() === '' || form.debitAccountId === '' || form.creditAccountId === '') return false
  const amount = Number(form.amount)
  if (form.amount === '' || !Number.isFinite(amount) || amount <= 0) return false
  return isScheduleFormValid(form)
}

/**
 * フォームの入力から、期日のプレビュー(previewUpcomingDueDates)に渡すためのルールを作る。保存はしない
 * (idは0、作成日時などは空)。呼び出し前にisScheduleFormValidで確認する
 */
export function ruleFromForm(form: RuleForm): RecurringTransactionRule {
  const input = buildRuleInput(form)
  return {
    id: 0,
    name: input.name,
    bookkeeperHouseholdMemberId: input.bookkeeperHouseholdMemberId ?? null,
    lines: input.lines.map((l, index) => ({
      lineNo: index + 1,
      side: l.side,
      accountId: l.accountId,
      amount: l.amount,
      projectId: l.projectId ?? null,
      householdMemberId: l.householdMemberId ?? null,
      counterpartyId: l.counterpartyId ?? null,
      settlementBatchId: l.settlementBatchId ?? null,
    })),
    frequency: input.frequency,
    dayOfWeek: input.dayOfWeek ?? null,
    dayOfMonth: input.dayOfMonth ?? null,
    weekOfMonth: input.weekOfMonth ?? null,
    monthOfYear: input.monthOfYear ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
    startsOn: input.startsOn!,
    endsOn: input.endsOn ?? null,
    interval: input.interval!,
    weekendAdjustment: input.weekendAdjustment!,
    amountMode: input.amountMode!,
    resumedOn: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  }
}
