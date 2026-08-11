/**
 * 仕訳入力フォームの借方合計・貸方合計・差額計算(計画Issue #32)のユニットテスト。
 * 入力中のフォーム行(金額は文字列のまま保持)から、リアルタイム表示用の合計値を
 * 算出する純粋関数を検証する。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { calculateJournalLineTotals } from './journalLineTotals'

describe('calculateJournalLineTotals', () => {
  it('行が0件の場合、借方合計・貸方合計・差額はすべて0になる', () => {
    expect(calculateJournalLineTotals([])).toEqual({
      debitTotal: 0,
      creditTotal: 0,
      difference: 0,
    })
  })

  it('借方・貸方の金額が一致する場合、差額は0になる', () => {
    const result = calculateJournalLineTotals([
      { side: 'debit', amountInput: '3000' },
      { side: 'credit', amountInput: '3000' },
    ])
    expect(result).toEqual({ debitTotal: 3000, creditTotal: 3000, difference: 0 })
  })

  it('複合仕訳(3行以上)の借方合計・貸方合計を正しく計算する', () => {
    const result = calculateJournalLineTotals([
      { side: 'debit', amountInput: '7000' },
      { side: 'debit', amountInput: '3000' },
      { side: 'credit', amountInput: '10000' },
    ])
    expect(result).toEqual({ debitTotal: 10000, creditTotal: 10000, difference: 0 })
  })

  it('借方・貸方が不一致の場合、差額(借方合計 - 貸方合計)を返す', () => {
    const result = calculateJournalLineTotals([
      { side: 'debit', amountInput: '5000' },
      { side: 'credit', amountInput: '3000' },
    ])
    expect(result).toEqual({ debitTotal: 5000, creditTotal: 3000, difference: 2000 })
  })

  it('金額が未入力(空文字)または数値に変換できない行は0として扱う', () => {
    const result = calculateJournalLineTotals([
      { side: 'debit', amountInput: '' },
      { side: 'debit', amountInput: 'abc' },
      { side: 'credit', amountInput: '1000' },
    ])
    expect(result).toEqual({ debitTotal: 0, creditTotal: 1000, difference: -1000 })
  })

  it('借方/貸方が未選択(null)の行は借方合計・貸方合計のいずれにも含めない', () => {
    const result = calculateJournalLineTotals([
      { side: null, amountInput: '5000' },
      { side: 'debit', amountInput: '1000' },
    ])
    expect(result).toEqual({ debitTotal: 1000, creditTotal: 0, difference: 1000 })
  })
})
