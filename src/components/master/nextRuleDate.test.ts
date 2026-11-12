/**
 * nextRuleDate(計画Issue #154)のテスト。
 * マスタ画面の定期取引の一覧に出す「次回」の日付を求める純粋関数を検証する。今日を含む
 * 今日以降で最初にルールに合致する日、無効なルールと回数の上限に達したルールは次回なし(null)、
 * 月末への丸めなど日付の計算自体は enumerateDueDates 側の仕様に従うことを確認する。計画Issue #164で
 * 追加した、土日の調整後の日付で返すこと、開始日より前は開始日以降の日、終了日(当日を含む)を過ぎた
 * ルールと終了日より後にしか期日が無いルールは次回なし、間隔(N回ごと)の周期に従うことも確認する。
 * DOM・DB非依存。
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
    startsOn: '2026-01-01',
    endsOn: null,
    interval: 1,
    weekendAdjustment: 'none',
    amountMode: 'fixed',
    resumedOn: null,
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

describe('nextRuleDate(スケジュールの拡張、計画Issue #164)', () => {
  it('土日の調整後の日付を返す(2026-11-29は日曜日、前平日調整なら11/27)', () => {
    expect(nextRuleDate(rule({ dayOfMonth: 29, weekendAdjustment: 'previous' }), '2026-11-07', 0)).toBe('2026-11-27')
  })

  it('翌平日調整なら、土日の期日は翌月曜日(2026-11-28は土曜日)', () => {
    expect(nextRuleDate(rule({ dayOfMonth: 28, weekendAdjustment: 'next' }), '2026-11-07', 0)).toBe('2026-11-30')
  })

  it('開始日が未来のルールは、開始日以降で最初の期日を返す', () => {
    expect(nextRuleDate(rule({ startsOn: '2026-12-01' }), '2026-11-07', 0)).toBe('2026-12-27')
  })

  it('開始日の当日が期日なら、その日を返す', () => {
    expect(nextRuleDate(rule({ startsOn: '2026-11-27' }), '2026-11-07', 0)).toBe('2026-11-27')
  })

  it('終了日の当日が期日なら返し、終了日より後にしか期日が無ければ次回なし', () => {
    expect(nextRuleDate(rule({ endsOn: '2026-11-27' }), '2026-11-07', 0)).toBe('2026-11-27')
    expect(nextRuleDate(rule({ endsOn: '2026-11-20' }), '2026-11-07', 0)).toBeNull()
  })

  it('終了日を過ぎたルールは次回なし(is_activeは有効のまま)', () => {
    expect(nextRuleDate(rule({ endsOn: '2026-10-31', isActive: true }), '2026-11-07', 0)).toBeNull()
  })

  it('間隔のあるルールは、開始日を基準にした周期の次の期日を返す(1月開始の3か月ごとは2月時点で4月)', () => {
    expect(
      nextRuleDate(rule({ dayOfMonth: 1, interval: 3, startsOn: '2026-01-01' }), '2026-02-10', 1),
    ).toBe('2026-04-01')
  })
})
