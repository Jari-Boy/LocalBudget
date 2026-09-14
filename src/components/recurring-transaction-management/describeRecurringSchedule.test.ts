/**
 * describeRecurringSchedule(docs/domain/recurring-transactions.md 1.3節の対応表)の
 * ユニットテスト。RecurringTransactionRuleのfrequency・day_of_week等のカラム組み合わせから
 * 人間可読な繰り返しスケジュール文字列(例:「毎週月曜日」「毎月25日」「毎月第2土曜日」
 * 「毎年6月1日」)を生成する純粋関数が、4パターンすべてで対応表通りの文言を返すことを検証する。
 * 外部依存: react-i18next(実際のja翻訳リソースを使用、ネットワークアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { describeRecurringSchedule } from './describeRecurringSchedule'

const t = i18n.getFixedT('ja', 'recurringTransaction')

function baseRule(overrides: Partial<RecurringTransactionRule>): RecurringTransactionRule {
  return {
    id: 1,
    name: 'テストルール',
    debitAccountId: 1,
    creditAccountId: 2,
    amount: 1000,
    frequency: 'weekly',
    dayOfWeek: null,
    dayOfMonth: null,
    weekOfMonth: null,
    monthOfYear: null,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    maxOccurrences: null,
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
