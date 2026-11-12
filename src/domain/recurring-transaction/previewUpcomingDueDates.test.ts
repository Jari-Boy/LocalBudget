/**
 * previewUpcomingDueDates(ルールの作成・編集フォームに出す、これからの期日のプレビュー、計画Issue #164)の
 * 純粋関数としてのユニットテスト。今日(を含む)以降の期日を、土日の調整後の日付とあわせて指定件数だけ
 * 返すこと、開始日より前・終了日より後・回数の上限を超える期日は含めないこと、間隔(N回ごと)に従うことを
 * 検証する。プレビューは保存せず、表示のたびにルールから再計算する(docs/domain/recurring-transactions.md 1.2)。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from './RecurringTransactionRule'
import { previewUpcomingDueDates } from './previewUpcomingDueDates'

function makeRule(overrides: Partial<RecurringTransactionRule> = {}): RecurringTransactionRule {
  return {
    id: 0,
    name: 'テストルール',
    bookkeeperHouseholdMemberId: null,
    lines: [
      { lineNo: 1, side: 'debit', accountId: 1, amount: 1000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      { lineNo: 2, side: 'credit', accountId: 2, amount: 1000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    ],
    schedule: [],
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 25,
    weekOfMonth: null,
    monthOfYear: null,
    maxOccurrences: null,
    startsOn: '2026-01-01',
    endsOn: null,
    interval: 1,
    weekendAdjustment: 'none',
    amountMode: 'fixed',
    resumedOn: null,
    isActive: true,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  }
}

describe('previewUpcomingDueDates', () => {
  it('今日を含む今日以降の期日を、指定した件数だけ返す(今日がちょうど期日なら含む)', () => {
    expect(previewUpcomingDueDates(makeRule(), '2026-11-25', 3)).toEqual([
      { dueDate: '2026-11-25', entryDate: '2026-11-25' },
      { dueDate: '2026-12-25', entryDate: '2026-12-25' },
      { dueDate: '2027-01-25', entryDate: '2027-01-25' },
    ])
  })

  it('土日の調整後の日付を、調整前の期日とあわせて返す(2026-10-24は土曜日、前平日調整で10/23)', () => {
    const rule = makeRule({ dayOfMonth: 24, weekendAdjustment: 'previous' })

    // 2026-10-24(土)→10/23、2026-11-24(火)、2026-12-24(木)
    expect(previewUpcomingDueDates(rule, '2026-10-01', 3)).toEqual([
      { dueDate: '2026-10-24', entryDate: '2026-10-23' },
      { dueDate: '2026-11-24', entryDate: '2026-11-24' },
      { dueDate: '2026-12-24', entryDate: '2026-12-24' },
    ])
  })

  it('開始日が未来なら、開始日以降の期日から返す', () => {
    expect(previewUpcomingDueDates(makeRule({ startsOn: '2027-03-01' }), '2026-11-01', 2).map((d) => d.dueDate)).toEqual([
      '2027-03-25',
      '2027-04-25',
    ])
  })

  it('間隔のあるルールは、開始日を基準にした周期に従う(1月開始の3か月ごとは1・4・7・10月)', () => {
    const rule = makeRule({ dayOfMonth: 1, interval: 3, startsOn: '2026-01-01' })

    expect(previewUpcomingDueDates(rule, '2026-02-01', 3).map((d) => d.dueDate)).toEqual([
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ])
  })

  it('終了日(当日を含む)より後の期日は含めず、件数に満たなくても打ち切る', () => {
    expect(previewUpcomingDueDates(makeRule({ endsOn: '2026-12-25' }), '2026-11-01', 5).map((d) => d.dueDate)).toEqual([
      '2026-11-25',
      '2026-12-25',
    ])
  })

  it('回数の上限を超える期日は含めない(上限は生成済み件数を引いた残りで数える)', () => {
    const rule = makeRule({ maxOccurrences: 3 })

    expect(previewUpcomingDueDates(rule, '2026-11-01', 5, 1).map((d) => d.dueDate)).toEqual([
      '2026-11-25',
      '2026-12-25',
    ])
  })

  it('件数が0のときは空配列を返す', () => {
    expect(previewUpcomingDueDates(makeRule(), '2026-11-01', 0)).toEqual([])
  })
})

describe('金額表のルール(計画Issue #180)', () => {
  it('表の長さを超える期日はプレビューに出さない', () => {
    const rule = makeRule({
      amountMode: 'schedule',
      schedule: [
        { round: 1, amounts: [] },
        { round: 2, amounts: [] },
      ],
    })

    expect(previewUpcomingDueDates(rule, '2026-01-01', 5, 0)).toHaveLength(2)
    expect(previewUpcomingDueDates(rule, '2026-01-01', 5, 1)).toHaveLength(1)
  })
})

