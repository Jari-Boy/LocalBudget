/**
 * shiftDateByMonths/shiftDateByYearsの純粋関数としてのユニットテスト。
 * BS(単一基準日)の比較機能(docs/domain/financial-statements.md 2.2節「比較」)向けに、
 * 「前期」=基準日を1ヶ月前にずらした日付、「前年同期」=1年前にずらした日付という
 * 実装時判断(計画Issue #34の懸念点)を実現する。月末日・うるう年2/29のクランプ
 * (存在しない日付にならないよう当月の末日に丸める)を中心に検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { shiftDateByMonths } from './shiftDateByMonths'
import { shiftDateByYears } from './shiftDateByYears'

describe('shiftDateByMonths', () => {
  it('通常の月内シフトでは同じ日を保つ', () => {
    expect(shiftDateByMonths('2026-07-15', -1)).toBe('2026-06-15')
  })

  it('負の月数で年をまたいで前年へ戻る', () => {
    expect(shiftDateByMonths('2026-01-15', -1)).toBe('2025-12-15')
  })

  it('正の月数で先の日付にずらせる', () => {
    expect(shiftDateByMonths('2026-01-15', 1)).toBe('2026-02-15')
  })

  it('シフト先の月に存在しない日は月末日にクランプする(3/31の1ヶ月前→2/28)', () => {
    expect(shiftDateByMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('シフト先がうるう年2月なら29日にクランプする', () => {
    expect(shiftDateByMonths('2028-03-31', -1)).toBe('2028-02-29')
  })
})

describe('shiftDateByYears', () => {
  it('通常の年シフトでは月日を保つ', () => {
    expect(shiftDateByYears('2026-07-15', -1)).toBe('2025-07-15')
  })

  it('うるう年2/29から平年へのシフトは2/28にクランプする', () => {
    expect(shiftDateByYears('2028-02-29', -1)).toBe('2027-02-28')
  })
})
