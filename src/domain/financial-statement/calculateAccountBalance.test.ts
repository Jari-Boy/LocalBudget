/**
 * calculateAccountBalance(残高計算の一般式)の純粋関数としてのユニットテスト。
 * docs/domain/financial-statements.md 2.1節の「資産・費用はdebit-credit、負債・純資産・収益は
 * credit-debit」という区分ごとの残高計算式を、各区分・増加側/減少側の組み合わせ・
 * 明細0件の境界値を含め検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { calculateAccountBalance } from './calculateAccountBalance'

describe('calculateAccountBalance', () => {
  it('資産区分は借方が増加側のため、借方合計から貸方合計を差し引いた値を返す', () => {
    expect(
      calculateAccountBalance('asset', [
        { side: 'debit', amount: 10000 },
        { side: 'credit', amount: 3000 },
      ]),
    ).toBe(7000)
  })

  it('費用区分も借方が増加側のため、debit-creditで計算する', () => {
    expect(
      calculateAccountBalance('expense', [
        { side: 'debit', amount: 5000 },
        { side: 'credit', amount: 1000 },
      ]),
    ).toBe(4000)
  })

  it('負債区分は貸方が増加側のため、貸方合計から借方合計を差し引いた値を返す', () => {
    expect(
      calculateAccountBalance('liability', [
        { side: 'credit', amount: 8000 },
        { side: 'debit', amount: 2000 },
      ]),
    ).toBe(6000)
  })

  it('純資産区分も貸方が増加側のため、credit-debitで計算する', () => {
    expect(
      calculateAccountBalance('equity', [
        { side: 'credit', amount: 20000 },
        { side: 'debit', amount: 500 },
      ]),
    ).toBe(19500)
  })

  it('収益区分も貸方が増加側のため、credit-debitで計算する', () => {
    expect(
      calculateAccountBalance('revenue', [
        { side: 'credit', amount: 30000 },
        { side: 'debit', amount: 0 },
      ]),
    ).toBe(30000)
  })

  it('減少側の金額が増加側を上回る場合は負の残高を返す(資産科目の貸方超過)', () => {
    expect(
      calculateAccountBalance('asset', [
        { side: 'debit', amount: 100 },
        { side: 'credit', amount: 300 },
      ]),
    ).toBe(-200)
  })

  it('明細が0件の場合は残高0を返す', () => {
    expect(calculateAccountBalance('asset', [])).toBe(0)
  })

  it('同じ区分の明細が複数行にわたる場合はそれぞれ合算してから差し引く', () => {
    expect(
      calculateAccountBalance('expense', [
        { side: 'debit', amount: 1000 },
        { side: 'debit', amount: 2000 },
        { side: 'credit', amount: 500 },
        { side: 'credit', amount: 500 },
      ]),
    ).toBe(2000)
  })
})
