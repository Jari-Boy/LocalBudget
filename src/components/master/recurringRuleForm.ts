import { assertValidAmountSchedule } from '../../domain/recurring-transaction/recurringAmountSchedule'
import type {
  CreateRecurringTransactionRuleInput,
  RecurringAmountMode,
  RecurringScheduleRound,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
  WeekendAdjustment,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEditorLine } from '../journal-entry/JournalEntryEditor'
import { summarizeBalance } from '../journal-entry/journalScreenModel'

/**
 * マスタ画面の定期仕訳ルールのフォーム入力と、Repository送信用の入力への変換(計画Issue #154)。
 * 旧・定期仕訳ルール管理画面(計画Issue #39)の内部関数を、純粋関数として取り出したもの。
 * 計画Issue #180で、借方1・貸方1の固定の欄から、仕訳エディタと同じ行編集の共通部品(JournalLinesEditor)で
 * 扱う行(lines)と、回ごとの金額表(schedule)に置き換えた。
 */

export type MonthlyMode = 'dayOfMonth' | 'weekday'

export interface RuleForm {
  name: string
  /** 起票者(ルール単位)。空は確認時に選ぶ。行の世帯メンバー(lines側)とは別 */
  householdMemberId: number | ''
  /** 行編集の共通部品で編集する行(2行でも3行以上でも同じ)。行の世帯メンバーがnullなら「行では決めない」 */
  lines: JournalEditorLine[]
  /** 回ごとの金額表(金額の初期値が金額表のときだけ使う)。行番号は lines の並び順(1始まり)に対応する */
  schedule: RecurringScheduleRound[]
  frequency: RecurringTransactionFrequency
  monthlyMode: MonthlyMode
  dayOfWeek: number | ''
  dayOfMonth: number | ''
  weekOfMonth: number | ''
  monthOfYear: number | ''
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

function emptyEditorLine(key: number, side: 'debit' | 'credit'): JournalEditorLine {
  return {
    key,
    line: { accountId: null, side, amountInput: '', projectId: null, householdMemberId: null, counterpartyId: null },
  }
}

/** 空のフォーム。開始日の既定は今日(過去日も指定できる)。行は借方1・貸方1の空の行 */
export function emptyRuleForm(today: string = new Date().toISOString().slice(0, 10)): RuleForm {
  return {
    name: '',
    householdMemberId: '',
    lines: [emptyEditorLine(1, 'debit'), emptyEditorLine(2, 'credit')],
    schedule: [],
    frequency: 'monthly',
    monthlyMode: 'dayOfMonth',
    dayOfWeek: '',
    dayOfMonth: '',
    weekOfMonth: '',
    monthOfYear: '',
    maxOccurrences: '',
    startsOn: today,
    endsOn: '',
    interval: '1',
    weekendAdjustment: 'none',
    amountMode: 'fixed',
  }
}

/**
 * ルールからフォームを復元する。行はすべて(3行以上も)、金額表は表のまま取り出す(計画Issue #180)。
 * フォームの「起票者」はルール単位の起票者(bookkeeperHouseholdMemberId)
 */
export function ruleFormFromRule(rule: RecurringTransactionRule): RuleForm {
  return {
    name: rule.name,
    householdMemberId: rule.bookkeeperHouseholdMemberId ?? '',
    lines: rule.lines.map((l, index) => ({
      key: index + 1,
      line: {
        accountId: l.accountId,
        side: l.side,
        amountInput: String(l.amount),
        projectId: l.projectId,
        householdMemberId: l.householdMemberId,
        counterpartyId: l.counterpartyId,
        settlementBatchId: l.settlementBatchId,
      },
    })),
    schedule: rule.schedule,
    frequency: rule.frequency,
    monthlyMode: rule.dayOfMonth !== null && rule.frequency === 'monthly' ? 'dayOfMonth' : 'weekday',
    dayOfWeek: rule.dayOfWeek ?? '',
    dayOfMonth: rule.dayOfMonth ?? '',
    weekOfMonth: rule.weekOfMonth ?? '',
    monthOfYear: rule.monthOfYear ?? '',
    maxOccurrences: rule.maxOccurrences === null ? '' : String(rule.maxOccurrences),
    startsOn: rule.startsOn,
    endsOn: rule.endsOn ?? '',
    interval: String(rule.interval),
    weekendAdjustment: rule.weekendAdjustment,
    amountMode: rule.amountMode,
  }
}

/**
 * 既存の仕訳から、定期仕訳のルールのフォームの初期値を作る(計画Issue #180、仕訳の詳細パネルの「定期仕訳にする」)。
 * 行をそのまま写し(科目・金額・取引先・プロジェクト・世帯メンバー・精算バッチ)、起票者は元の仕訳の起票者、
 * 名称は元の摘要。繰り返しは「毎月、その仕訳の日付の日」、開始日は元の仕訳の翌日。元の仕訳は変更せず、
 * 生成済みの1回目としても紐づけない(手入力の仕訳の作成経路を書き換えないため)
 */
export function ruleFormFromEntry(entry: JournalEntry): RuleForm {
  const nextDay = new Date(Date.parse(`${entry.entryDate}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    ...emptyRuleForm(nextDay),
    name: entry.memo ?? '',
    householdMemberId: entry.householdMemberId,
    lines: entry.lines.map((l, index) => ({
      key: index + 1,
      line: {
        accountId: l.accountId,
        side: l.side,
        amountInput: String(l.amount),
        projectId: l.projectId,
        householdMemberId: l.householdMemberId,
        counterpartyId: l.counterpartyId,
        settlementBatchId: l.settlementBatchId,
      },
    })),
    frequency: 'monthly',
    monthlyMode: 'dayOfMonth',
    dayOfMonth: Number(entry.entryDate.slice(8, 10)),
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
 * 行はそのまま(行編集の共通部品が、取引先をPL科目の行にだけ・精算バッチを立替金・未払金の行にだけ
 * 持たせる)。行の世帯メンバーがnullの行は、確定時に 科目の既定メンバー > 起票者 で決まる。金額表のルールの
 * 行の金額は、Repositoryが1回目の金額に置き換える(ここでは仮の1を渡す)
 */
export function buildRuleInput(form: RuleForm): CreateRecurringTransactionRuleInput {
  const isSchedule = form.amountMode === 'schedule'
  return {
    name: form.name.trim(),
    bookkeeperHouseholdMemberId: orNull(form.householdMemberId),
    lines: form.lines.map(({ line }) => ({
      side: line.side as 'debit' | 'credit',
      accountId: line.accountId as number,
      amount: isSchedule ? 1 : Number(line.amountInput),
      projectId: line.projectId,
      householdMemberId: line.householdMemberId,
      counterpartyId: line.counterpartyId,
      settlementBatchId: line.settlementBatchId ?? null,
    })),
    ...(isSchedule ? { schedule: form.schedule } : {}),
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

/** 行の構成と金額表が、金額表のルールとして有効か(回の連続・各回の全行の金額・各回の貸借の一致) */
export function isScheduleTableValid(form: RuleForm): boolean {
  try {
    assertValidAmountSchedule(
      form.lines.map(({ line }, index) => ({ lineNo: index + 1, side: line.side as 'debit' | 'credit' })),
      form.schedule,
    )
    return true
  } catch {
    return false
  }
}

/**
 * 必須項目(名称・行の科目・金額)と、スケジュールの入力(isScheduleFormValid)が揃っているか。
 * 行は2行以上で、すべて科目が選ばれている。金額の初期値が金額表なら金額表が有効(isScheduleTableValid)、
 * それ以外は各行の金額が正で、借方の合計と貸方の合計が一致する(仕訳と同じ検証)
 */
export function isRuleFormValid(form: RuleForm): boolean {
  if (form.name.trim() === '' || form.lines.length < 2) return false
  if (form.lines.some(({ line }) => line.accountId === null)) return false
  if (form.amountMode === 'schedule') {
    if (!isScheduleTableValid(form)) return false
  } else {
    const amounts = form.lines.map(({ line }) => Number(line.amountInput))
    if (form.lines.some(({ line }, i) => line.amountInput.trim() === '' || !Number.isInteger(amounts[i]) || amounts[i] <= 0)) {
      return false
    }
    if (!summarizeBalance(form.lines.map((l) => l.line)).isBalanced) return false
  }
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
    schedule: input.schedule ?? [],
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
