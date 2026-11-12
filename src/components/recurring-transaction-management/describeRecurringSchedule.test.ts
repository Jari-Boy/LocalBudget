/**
 * describeRecurringSchedule(docs/domain/recurring-transactions.md 1.3節の対応表)の
 * ユニットテスト。RecurringTransactionRuleのfrequency・day_of_week等のカラム組み合わせから
 * 人間可読な繰り返しスケジュール文字列(例:「毎週月曜日」「毎月25日」「毎月第2土曜日」
 * 「毎年6月1日」)を生成する純粋関数が、4パターンすべてで対応表通りの文言を返すことを検証する。
 * 計画Issue #164で追加した、間隔(「3か月ごと」「2週ごと」「2年ごと」)・土日の調整・期間の補足文
 * (describeRecurringScheduleNotes)も検証する。
 * 外部依存: react-i18next(実際のja翻訳リソースを使用、ネットワークアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { describeRecurringSchedule, describeRecurringScheduleNotes } from './describeRecurringSchedule'

const t = i18n.getFixedT('ja', 'recurringTransaction')

function baseRule(overrides: Partial<RecurringTransactionRule>): RecurringTransactionRule {
  return {
    id: 1,
    name: 'テストルール',
    bookkeeperHouseholdMemberId: null,
    lines: [
      { lineNo: 1, side: 'debit', accountId: 1, amount: 1000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      { lineNo: 2, side: 'credit', accountId: 2, amount: 1000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    ],
    frequency: 'weekly',
    dayOfWeek: null,
    dayOfMonth: null,
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
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

describe('describeRecurringSchedule', () => {
  it('weeklyは「毎週◯曜日」を返す(月曜日の例)', () => {
    const rule = baseRule({ frequency: 'weekly', dayOfWeek: 1 })
    expect(describeRecurringSchedule(rule, t)).toBe('毎週月曜日')
  })

  it('monthly(日付指定)は「毎月◯日」を返す(25日の例)', () => {
    const rule = baseRule({ frequency: 'monthly', dayOfMonth: 25 })
    expect(describeRecurringSchedule(rule, t)).toBe('毎月25日')
  })

  it('monthly(曜日指定)は「毎月第◯◯曜日」を返す(第2土曜日の例)', () => {
    const rule = baseRule({ frequency: 'monthly', weekOfMonth: 2, dayOfWeek: 6 })
    expect(describeRecurringSchedule(rule, t)).toBe('毎月第2土曜日')
  })

  it('monthly(曜日指定・最終週)は「毎月最終◯曜日」を返す', () => {
    const rule = baseRule({ frequency: 'monthly', weekOfMonth: -1, dayOfWeek: 5 })
    expect(describeRecurringSchedule(rule, t)).toBe('毎月最終金曜日')
  })

  it('yearlyは「毎年◯月◯日」を返す(6月1日の例)', () => {
    const rule = baseRule({ frequency: 'yearly', monthOfYear: 6, dayOfMonth: 1 })
    expect(describeRecurringSchedule(rule, t)).toBe('毎年6月1日')
  })
})

describe('間隔(計画Issue #164)', () => {
  it('weekly: 間隔が2以上なら「2週ごと◯曜日」を返す', () => {
    expect(describeRecurringSchedule(baseRule({ frequency: 'weekly', dayOfWeek: 5, interval: 2 }), t)).toBe(
      '2週ごと金曜日',
    )
  })

  it('monthly(日付指定): 間隔が2以上なら「3か月ごと◯日」を返す', () => {
    expect(describeRecurringSchedule(baseRule({ frequency: 'monthly', dayOfMonth: 1, interval: 3 }), t)).toBe(
      '3か月ごと1日',
    )
  })

  it('monthly(曜日指定): 間隔が2以上なら「2か月ごと第◯◯曜日」を返す', () => {
    expect(
      describeRecurringSchedule(baseRule({ frequency: 'monthly', weekOfMonth: 2, dayOfWeek: 6, interval: 2 }), t),
    ).toBe('2か月ごと第2土曜日')
  })

  it('yearly: 間隔が2以上なら「2年ごと◯月◯日」を返す', () => {
    expect(
      describeRecurringSchedule(baseRule({ frequency: 'yearly', monthOfYear: 6, dayOfMonth: 1, interval: 2 }), t),
    ).toBe('2年ごと6月1日')
  })

  it('間隔が1のときは従来の文言のまま', () => {
    expect(describeRecurringSchedule(baseRule({ frequency: 'monthly', dayOfMonth: 25, interval: 1 }), t)).toBe(
      '毎月25日',
    )
  })
})

describe('describeRecurringScheduleNotes(繰り返しの補足、計画Issue #164)', () => {
  it('補足の無いルールは空配列を返す', () => {
    expect(describeRecurringScheduleNotes(baseRule({}), t)).toEqual([])
  })

  it('土日の調整は「土日は翌平日」「土日は前の平日」と補足する', () => {
    expect(describeRecurringScheduleNotes(baseRule({ weekendAdjustment: 'next' }), t)).toEqual(['土日は翌平日'])
    expect(describeRecurringScheduleNotes(baseRule({ weekendAdjustment: 'previous' }), t)).toEqual([
      '土日は前の平日',
    ])
  })

  it('開始日が今日より後の予定でも、終了日・回数の上限は期間として補足する', () => {
    expect(describeRecurringScheduleNotes(baseRule({ endsOn: '2027-03-05' }), t)).toEqual(['2027/03/05まで'])
    expect(describeRecurringScheduleNotes(baseRule({ maxOccurrences: 24 }), t)).toEqual(['24回まで'])
  })

  it('複数あるときは、土日の調整・終了日・回数の上限の順に並べる', () => {
    expect(
      describeRecurringScheduleNotes(
        baseRule({ weekendAdjustment: 'previous', endsOn: '2027-03-05', maxOccurrences: 24 }),
        t,
      ),
    ).toEqual(['土日は前の平日', '2027/03/05まで', '24回まで'])
  })
})
