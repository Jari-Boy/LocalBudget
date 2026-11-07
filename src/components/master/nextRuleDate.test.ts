/**
 * nextRuleDate(計画Issue #154)のテスト。
 * マスタ画面の定期取引の一覧に出す「次回」の日付を求める純粋関数を検証する。今日を含む
 * 今日以降で最初にルールに合致する日、無効なルールと回数の上限に達したルールは次回なし(null)、
 * 月末への丸めなど日付の計算自体は enumerateDueDates 側の仕様に従うことを確認する。DOM・DB非依存。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { nextRuleDate } from './nextRuleDate'

function rule(overrides: Partial<RecurringTransactionRule> = {}): RecurringTransactionRule {
  return {
    id: 1,
    name: '家賃',
    debitAccountId: 1,
    creditAccountId: 2,
    amount: 98000,
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 27,
    weekOfMonth: null,
    monthOfYear: null,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    maxOccurrences: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('nextRuleDate', () => {
  it('今日より後に最初に合致する日を返す', () => {
    expect(nextRuleDate(rule(), '2026-11-07', 0)).toBe('2026-11-27')
  })

  it('今日がちょうど発生日なら、今日を返す', () => {
    expect(nextRuleDate(rule(), '2026-11-27', 0)).toBe('2026-11-27')
  })

  it('今月の発生日を過ぎていれば、翌月を返す', () => {
    expect(nextRuleDate(rule(), '2026-11-28', 0)).toBe('2026-12-27')
  })

  it('毎年のルールは、翌年の日付を返すことがある', () => {
    const yearly = rule({ frequency: 'yearly', monthOfYear: 4, dayOfMonth: 10 })

    expect(nextRuleDate(yearly, '2026-11-07', 0)).toBe('2027-04-10')
  })

  it('無効なルールは、次回なし(null)である', () => {
    expect(nextRuleDate(rule({ isActive: false }), '2026-11-07', 0)).toBeNull()
  })

  it('回数の上限に達したルールは、次回なし(null)で、達していなければ返す', () => {
    expect(nextRuleDate(rule({ maxOccurrences: 3 }), '2026-11-07', 3)).toBeNull()
    expect(nextRuleDate(rule({ maxOccurrences: 3 }), '2026-11-07', 2)).toBe('2026-11-27')
  })
})
