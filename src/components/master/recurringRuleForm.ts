import type {
  CreateRecurringTransactionRuleInput,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
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
}

export function emptyRuleForm(): RuleForm {
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
  }
}

export function ruleFormFromRule(rule: RecurringTransactionRule): RuleForm {
  return {
    name: rule.name,
    debitAccountId: rule.debitAccountId,
    creditAccountId: rule.creditAccountId,
    amount: String(rule.amount),
    frequency: rule.frequency,
    monthlyMode: rule.dayOfMonth !== null && rule.frequency === 'monthly' ? 'dayOfMonth' : 'weekday',
    dayOfWeek: rule.dayOfWeek ?? '',
    dayOfMonth: rule.dayOfMonth ?? '',
    weekOfMonth: rule.weekOfMonth ?? '',
    monthOfYear: rule.monthOfYear ?? '',
    projectId: rule.projectId ?? '',
    householdMemberId: rule.householdMemberId ?? '',
    counterpartyId: rule.counterpartyId ?? '',
    maxOccurrences: rule.maxOccurrences === null ? '' : String(rule.maxOccurrences),
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

/** フォーム入力からRepository送信用の入力を組み立てる。呼び出し前にisRuleFormValidで確認する */
export function buildRuleInput(form: RuleForm): CreateRecurringTransactionRuleInput {
  return {
    name: form.name.trim(),
    debitAccountId: form.debitAccountId as number,
    creditAccountId: form.creditAccountId as number,
    amount: Number(form.amount),
    frequency: form.frequency,
    ...scheduleColumns(form),
    projectId: orNull(form.projectId),
    householdMemberId: orNull(form.householdMemberId),
    counterpartyId: orNull(form.counterpartyId),
    maxOccurrences: parseMaxOccurrences(form.maxOccurrences),
  }
}

/** 必須項目と、繰り返しごとに必要な項目、回数の上限(空か正の整数)が揃っているか */
export function isRuleFormValid(form: RuleForm): boolean {
  if (form.name.trim() === '' || form.debitAccountId === '' || form.creditAccountId === '') return false
  const amount = Number(form.amount)
  if (form.amount === '' || !Number.isFinite(amount) || amount <= 0) return false

  const max = parseMaxOccurrences(form.maxOccurrences)
  if (max !== null && (!Number.isInteger(max) || max <= 0)) return false

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
