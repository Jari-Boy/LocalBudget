/**
 * journalFilterModel の buildEntryRangeOptions(期間の月の選択肢と、金額スライダーの上限の元になる値を、
 * 絞り込む対象の仕訳から求める関数、計画Issue #314)のユニットテスト。日付は仕訳の取引日、最大金額は仕訳の金額(借方合計)の
 * 最大であること、仕訳が無いときは空・0であることを検証する。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildEntryRangeOptions } from './journalFilterModel'

const entry = (entryDate: string, ...lines: { side: 'debit' | 'credit'; amount: number }[]) => ({ entryDate, lines })

describe('buildEntryRangeOptions', () => {
  it('仕訳の取引日を、重複なく古い順に返す', () => {
    const result = buildEntryRangeOptions([
      entry('2026-11-03', { side: 'debit', amount: 100 }),
      entry('2026-09-15', { side: 'debit', amount: 100 }),
      entry('2026-11-03', { side: 'debit', amount: 100 }),
    ])

    expect(result.entryDates).toEqual(['2026-09-15', '2026-11-03'])
  })

  it('最大金額は、仕訳ごとの借方合計(貸方は数えない)の最大にする', () => {
    const result = buildEntryRangeOptions([
      entry(
        '2026-11-03',
        { side: 'debit', amount: 3000 },
        { side: 'debit', amount: 2000 },
        { side: 'credit', amount: 5000 },
      ),
      entry('2026-11-04', { side: 'debit', amount: 4000 }, { side: 'credit', amount: 4000 }),
    ])

    expect(result.maxAmount).toBe(5000)
  })

  it('仕訳が無いときは、日付は空・最大金額は0', () => {
    expect(buildEntryRangeOptions([])).toEqual({ entryDates: [], maxAmount: 0 })
  })
})
