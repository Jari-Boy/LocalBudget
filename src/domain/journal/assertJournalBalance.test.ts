/**
 * assertJournalBalance(貸借バランス検証)の純粋関数としてのユニットテスト。
 * docs/domain/journal.md 1.3の「借方合計=貸方合計」という仕訳の整合性ルールを、
 * 境界値(明細0件・1件のみ・借方のみ・大量行・ちょうど一致等)を含め検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { assertJournalBalance } from './assertJournalBalance'
import { UnbalancedJournalEntryError } from './UnbalancedJournalEntryError'

describe('assertJournalBalance', () => {
  it('明細が0件のときは借方合計・貸方合計とも0で一致するためスローしない', () => {
    expect(() => assertJournalBalance([])).not.toThrow()
  })

  it('借方1行のみでは貸方合計0との不一致でスローする', () => {
    expect(() => assertJournalBalance([{ side: 'debit', amount: 1000 }])).toThrow(
      UnbalancedJournalEntryError,
    )
  })

  it('借方のみ複数行(貸方が存在しない)場合はスローする', () => {
    expect(() =>
      assertJournalBalance([
        { side: 'debit', amount: 3000 },
        { side: 'debit', amount: 2000 },
      ]),
    ).toThrow(UnbalancedJournalEntryError)
  })

  it('借方合計と貸方合計がちょうど一致する場合はスローしない', () => {
    expect(() =>
      assertJournalBalance([
        { side: 'debit', amount: 7000 },
        { side: 'debit', amount: 3000 },
        { side: 'credit', amount: 10000 },
      ]),
    ).not.toThrow()
  })

  it('借方合計と貸方合計が1円でも異なる場合はスローする', () => {
    expect(() =>
      assertJournalBalance([
        { side: 'debit', amount: 10000 },
        { side: 'credit', amount: 9999 },
      ]),
    ).toThrow(UnbalancedJournalEntryError)
  })

  it('大量行でも借方合計・貸方合計を正しく集計して一致を判定できる', () => {
    const debitLines = Array.from({ length: 500 }, () => ({
      side: 'debit' as const,
      amount: 1,
    }))
    const creditLines = [{ side: 'credit' as const, amount: 500 }]

    expect(() => assertJournalBalance([...debitLines, ...creditLines])).not.toThrow()
  })

  it('スローされたエラーが借方合計・貸方合計をプロパティとして保持する', () => {
    expect.assertions(3)
    try {
      assertJournalBalance([
        { side: 'debit', amount: 5000 },
        { side: 'credit', amount: 4000 },
      ])
    } catch (error) {
      expect(error).toBeInstanceOf(UnbalancedJournalEntryError)
      expect((error as UnbalancedJournalEntryError).debitTotal).toBe(5000)
      expect((error as UnbalancedJournalEntryError).creditTotal).toBe(4000)
    }
  })
})
