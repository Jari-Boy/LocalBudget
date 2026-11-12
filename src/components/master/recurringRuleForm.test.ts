/**
 * recurringRuleForm(計画Issue #154)のテスト。
 * マスタ画面の定期取引ルールのフォーム入力を、Repository送信用の入力に変換する純粋関数を検証する。
 * 繰り返し(毎週・毎月の日付・毎月の第N曜日・毎年)ごとに使うカラムの組み合わせ
 * (docs/domain/recurring-transactions.md 1.3、使わないカラムは必ずnull)、入力が揃ったかの判定、
 * 既存ルールからフォームへの復元を確認する。計画Issue #164で追加した、開始日(既定は今日)・終了日・
 * 間隔(1以上の整数)・土日の調整・金額の初期値の変換と、その妥当性(終了日は開始日以後)も確認する。
 * DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { JournalEditorLine } from '../journal-entry/JournalEntryEditor'
import {
  buildRuleInput,
  emptyRuleForm,
  isRuleFormValid,
  ruleFormFromRule,
  type RuleForm,
} from './recurringRuleForm'

const editorLine = (
  key: number,
  side: 'debit' | 'credit',
  accountId: number | null,
  amount: string,
  extra: Partial<JournalEditorLine['line']> = {},
): JournalEditorLine => ({
  key,
  line: { accountId, side, amountInput: amount, projectId: null, householdMemberId: null, counterpartyId: null, ...extra },
})

const twoLines = (amount = '98000') => [editorLine(1, 'debit', 1, amount), editorLine(2, 'credit', 2, amount)]

function form(overrides: Partial<RuleForm> = {}): RuleForm {
  return {
    ...emptyRuleForm(),
    name: '家賃',
    lines: twoLines(),
    frequency: 'monthly',
    monthlyMode: 'dayOfMonth',
    dayOfMonth: 27,
    ...overrides,
  }
}

describe('buildRuleInput', () => {
  it('毎月の日付指定では、日だけを使い、曜日・週・月はnullにする', () => {
    expect(buildRuleInput(form({ dayOfWeek: 3, weekOfMonth: 2, monthOfYear: 5 }))).toMatchObject({
      frequency: 'monthly',
      dayOfMonth: 27,
      dayOfWeek: null,
      weekOfMonth: null,
      monthOfYear: null,
    })
  })

  it('毎月の第N曜日指定では、週と曜日を使い、日はnullにする', () => {
    expect(
      buildRuleInput(form({ monthlyMode: 'weekday', weekOfMonth: 2, dayOfWeek: 6, dayOfMonth: 27 })),
    ).toMatchObject({ dayOfMonth: null, weekOfMonth: 2, dayOfWeek: 6, monthOfYear: null })
  })

  it('毎週では、曜日だけを使う', () => {
    expect(buildRuleInput(form({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 27 }))).toMatchObject({
      dayOfWeek: 1,
      dayOfMonth: null,
      weekOfMonth: null,
      monthOfYear: null,
    })
  })

  it('毎年では、月と日を使う', () => {
    expect(buildRuleInput(form({ frequency: 'yearly', monthOfYear: 4, dayOfMonth: 10 }))).toMatchObject({
      monthOfYear: 4,
      dayOfMonth: 10,
      dayOfWeek: null,
      weekOfMonth: null,
    })
  })

  it('名称・行・任意項目を、型を整えて渡す(空の任意項目はnull)', () => {
    const lines = [
      editorLine(1, 'debit', 1, '98000', { projectId: 7, counterpartyId: 5 }),
      editorLine(2, 'credit', 2, '98000', { projectId: 7 }),
    ]

    const input = buildRuleInput(form({ name: ' 家賃 ', lines, maxOccurrences: '12' }))

    expect(input).toMatchObject({ name: '家賃', bookkeeperHouseholdMemberId: null, maxOccurrences: 12 })
    expect(input.lines).toEqual([
      { side: 'debit', accountId: 1, amount: 98000, projectId: 7, householdMemberId: null, counterpartyId: 5, settlementBatchId: null },
      { side: 'credit', accountId: 2, amount: 98000, projectId: 7, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    ])
    expect(buildRuleInput(form()).maxOccurrences).toBeNull()
  })

  it('3行以上の複合仕訳は、全行を渡す。起票者はルール単位、行の世帯メンバーは行単位に渡す(計画Issue #180)', () => {
    const lines = [
      editorLine(1, 'debit', 1, '280000', { householdMemberId: 4 }),
      editorLine(2, 'debit', 3, '80000'),
      editorLine(3, 'credit', 2, '360000'),
    ]

    const input = buildRuleInput(form({ lines, householdMemberId: 3 }))

    expect(input.bookkeeperHouseholdMemberId).toBe(3)
    expect(input.lines.map((l) => [l.accountId, l.amount, l.householdMemberId])).toEqual([
      [1, 280000, 4],
      [3, 80000, null],
      [2, 360000, null],
    ])
  })

  it('金額の初期値が金額表なら、金額表を渡す(行の金額は仮の1。保存時に1回目の金額になる)', () => {
    const schedule = [{ round: 1, amounts: [{ lineNo: 1, amount: 100 }, { lineNo: 2, amount: 100 }] }]

    const input = buildRuleInput(form({ amountMode: 'schedule', schedule }))

    expect(input.schedule).toEqual(schedule)
    expect(input.lines.map((l) => l.amount)).toEqual([1, 1])
    expect(buildRuleInput(form()).schedule).toBeUndefined()
  })
})

describe('isRuleFormValid', () => {
  it('必須項目が揃っていれば有効である', () => {
    expect(isRuleFormValid(form())).toBe(true)
  })

  it('名称・行の科目・行の金額のどれかが欠けると無効である', () => {
    expect(isRuleFormValid(form({ name: ' ' }))).toBe(false)
    expect(isRuleFormValid(form({ lines: [editorLine(1, 'debit', null, '1'), editorLine(2, 'credit', 2, '1')] }))).toBe(false)
    expect(isRuleFormValid(form({ lines: twoLines('') }))).toBe(false)
    expect(isRuleFormValid(form({ lines: twoLines('0') }))).toBe(false)
    expect(isRuleFormValid(form({ lines: twoLines('abc') }))).toBe(false)
  })

  it('貸借が一致しない行構成、2行未満は無効で、3行以上でも貸借が一致すれば有効である(計画Issue #180)', () => {
    expect(isRuleFormValid(form({ lines: [editorLine(1, 'debit', 1, '100'), editorLine(2, 'credit', 2, '90')] }))).toBe(false)
    expect(isRuleFormValid(form({ lines: [editorLine(1, 'debit', 1, '100')] }))).toBe(false)
    expect(
      isRuleFormValid(
        form({ lines: [editorLine(1, 'debit', 1, '60'), editorLine(2, 'debit', 3, '40'), editorLine(3, 'credit', 2, '100')] }),
      ),
    ).toBe(true)
  })

  it('金額の初期値が金額表のときは、行の金額ではなく金額表の有効性で判定する(貸借が一致しない回があれば無効)', () => {
    const lines = [editorLine(1, 'debit', 1, ''), editorLine(2, 'credit', 2, '')]
    const ok = [{ round: 1, amounts: [{ lineNo: 1, amount: 5 }, { lineNo: 2, amount: 5 }] }]
    const off = [{ round: 1, amounts: [{ lineNo: 1, amount: 5 }, { lineNo: 2, amount: 4 }] }]

    expect(isRuleFormValid(form({ amountMode: 'schedule', lines, schedule: ok }))).toBe(true)
    expect(isRuleFormValid(form({ amountMode: 'schedule', lines, schedule: off }))).toBe(false)
    expect(isRuleFormValid(form({ amountMode: 'schedule', lines, schedule: [] }))).toBe(false)
  })

  it('繰り返しごとに必要な項目が欠けると無効である', () => {
    expect(isRuleFormValid(form({ dayOfMonth: '' }))).toBe(false)
    expect(isRuleFormValid(form({ frequency: 'weekly', dayOfWeek: '' }))).toBe(false)
    expect(isRuleFormValid(form({ monthlyMode: 'weekday', weekOfMonth: '', dayOfWeek: 1 }))).toBe(false)
    expect(isRuleFormValid(form({ frequency: 'yearly', monthOfYear: '', dayOfMonth: 10 }))).toBe(false)
  })

  it('回数の上限は、空か正の整数のときだけ有効である', () => {
    expect(isRuleFormValid(form({ maxOccurrences: '12' }))).toBe(true)
    expect(isRuleFormValid(form({ maxOccurrences: '0' }))).toBe(false)
    expect(isRuleFormValid(form({ maxOccurrences: '1.5' }))).toBe(false)
  })
})

describe('ruleFormFromRule', () => {
  const rule: RecurringTransactionRule = {
    id: 1,
    name: '燃えるごみ袋',
    bookkeeperHouseholdMemberId: 5,
    lines: [
      { lineNo: 1, side: 'debit', accountId: 1, amount: 600, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      { lineNo: 2, side: 'credit', accountId: 2, amount: 600, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    ],
    schedule: [],
    frequency: 'monthly',
    dayOfWeek: 6,
    dayOfMonth: null,
    weekOfMonth: 2,
    monthOfYear: null,
    maxOccurrences: null,
    startsOn: '2026-01-01',
    endsOn: null,
    interval: 1,
    weekendAdjustment: 'none',
    amountMode: 'fixed',
    resumedOn: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('行は3行以上も含めて全行(科目・金額・取引先・精算バッチ)を、金額表は表のまま復元する(計画Issue #180)', () => {
    const complex: RecurringTransactionRule = {
      ...rule,
      amountMode: 'schedule',
      lines: [
        { lineNo: 1, side: 'debit', accountId: 1, amount: 100, projectId: 9, householdMemberId: 4, counterpartyId: 6, settlementBatchId: null },
        { lineNo: 2, side: 'debit', accountId: 3, amount: 10, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: 8 },
        { lineNo: 3, side: 'credit', accountId: 2, amount: 110, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      ],
      schedule: [{ round: 1, amounts: [{ lineNo: 1, amount: 100 }, { lineNo: 2, amount: 10 }, { lineNo: 3, amount: 110 }] }],
    }

    const restored = ruleFormFromRule(complex)

    expect(restored.lines.map((l) => [l.key, l.line.side, l.line.accountId, l.line.amountInput])).toEqual([
      [1, 'debit', 1, '100'],
      [2, 'debit', 3, '10'],
      [3, 'credit', 2, '110'],
    ])
    expect(restored.lines[0].line).toMatchObject({ projectId: 9, householdMemberId: 4, counterpartyId: 6 })
    expect(restored.lines[1].line.settlementBatchId).toBe(8)
    expect(restored.schedule).toEqual(complex.schedule)
    expect(restored.amountMode).toBe('schedule')
  })

  it('毎月の第N曜日のルールは、指定方法が曜日のフォームに復元される', () => {
    expect(ruleFormFromRule(rule)).toMatchObject({
      name: '燃えるごみ袋',
      monthlyMode: 'weekday',
      weekOfMonth: 2,
      dayOfWeek: 6,
      householdMemberId: 5,
      maxOccurrences: '',
    })
  })

  it('復元したフォームをbuildRuleInputに通すと、元のカラムの組み合わせに戻る', () => {
    expect(buildRuleInput(ruleFormFromRule(rule))).toMatchObject({
      dayOfMonth: null,
      weekOfMonth: 2,
      dayOfWeek: 6,
      bookkeeperHouseholdMemberId: 5,
    })
  })
})

describe('スケジュールの拡張(計画Issue #164)', () => {
  it('空のフォームは、開始日が今日・終了日なし・1回ごと・土日の調整なし・金額は固定になる', () => {
    expect(emptyRuleForm('2026-11-12')).toMatchObject({
      startsOn: '2026-11-12',
      endsOn: '',
      interval: '1',
      weekendAdjustment: 'none',
      amountMode: 'fixed',
    })
  })

  it('フォームの開始日・終了日・間隔・土日の調整・金額の初期値が、送信用の入力に変換される', () => {
    expect(
      buildRuleInput(
        form({
          startsOn: '2026-01-15',
          endsOn: '2026-12-31',
          interval: '3',
          weekendAdjustment: 'previous',
          amountMode: 'last_confirmed',
        }),
      ),
    ).toMatchObject({
      startsOn: '2026-01-15',
      endsOn: '2026-12-31',
      interval: 3,
      weekendAdjustment: 'previous',
      amountMode: 'last_confirmed',
    })
  })

  it('終了日が空なら、送信用の入力ではnull(終了なし)になる', () => {
    expect(buildRuleInput(form({ endsOn: '' }))).toMatchObject({ endsOn: null })
  })

  it('間隔は、1以上の整数のときだけ有効である', () => {
    expect(isRuleFormValid(form({ interval: '2' }))).toBe(true)
    expect(isRuleFormValid(form({ interval: '0' }))).toBe(false)
    expect(isRuleFormValid(form({ interval: '1.5' }))).toBe(false)
    expect(isRuleFormValid(form({ interval: '' }))).toBe(false)
  })

  it('開始日は必須で、終了日は空か開始日以後のときだけ有効である(同じ日は有効)', () => {
    expect(isRuleFormValid(form({ startsOn: '' }))).toBe(false)
    expect(isRuleFormValid(form({ startsOn: '2026-05-01', endsOn: '2026-05-01' }))).toBe(true)
    expect(isRuleFormValid(form({ startsOn: '2026-05-01', endsOn: '2026-04-30' }))).toBe(false)
    expect(isRuleFormValid(form({ startsOn: '2026-05-01', endsOn: '' }))).toBe(true)
  })

  it('既存ルールのスケジュールの項目が、フォームに復元される(終了日なしは空文字)', () => {
    const base: RecurringTransactionRule = {
      id: 1,
      name: '電気代',
      bookkeeperHouseholdMemberId: null,
      lines: [
        { lineNo: 1, side: 'debit', accountId: 1, amount: 8000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
        { lineNo: 2, side: 'credit', accountId: 2, amount: 8000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      ],
      schedule: [],
      frequency: 'monthly',
      dayOfWeek: null,
      dayOfMonth: 10,
      weekOfMonth: null,
      monthOfYear: null,
      maxOccurrences: null,
      startsOn: '2026-02-01',
      endsOn: null,
      interval: 3,
      weekendAdjustment: 'next',
      amountMode: 'last_confirmed',
      resumedOn: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    expect(ruleFormFromRule(base)).toMatchObject({
      startsOn: '2026-02-01',
      endsOn: '',
      interval: '3',
      weekendAdjustment: 'next',
      amountMode: 'last_confirmed',
    })
    expect(ruleFormFromRule({ ...base, endsOn: '2026-12-31' }).endsOn).toBe('2026-12-31')
  })
})
