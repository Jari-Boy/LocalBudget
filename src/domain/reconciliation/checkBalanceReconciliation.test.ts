/**
 * checkBalanceReconciliation(残高照合)の純粋関数としてのユニットテスト。
 * docs/domain/reconciliation.md 1.5の「対象口座の帳簿残高(該当行の積み上げ)と外部残高
 * (external_balance_after)を比較する」というルールを、一致・不足・超過・0件・複数行の
 * 積み上げを含め検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { checkBalanceReconciliation } from './checkBalanceReconciliation'

describe('checkBalanceReconciliation', () => {
  it('積み上げた帳簿残高が外部残高と一致する場合はisReconciled=trueでdifferenceは0', () => {
    const result = checkBalanceReconciliation(
      [
        { side: 'debit', amount: 10000 },
        { side: 'credit', amount: 150 },
      ],
      9850,
    )

    expect(result.bookBalance).toBe(9850)
    expect(result.isReconciled).toBe(true)
    expect(result.difference).toBe(0)
  })

  it('帳簿残高が外部残高より少ない(取り込み漏れ等)場合はdifferenceが正で不一致', () => {
    const result = checkBalanceReconciliation([{ side: 'debit', amount: 9000 }], 9850)

    expect(result.bookBalance).toBe(9000)
    expect(result.difference).toBe(850)
    expect(result.isReconciled).toBe(false)
  })

  it('帳簿残高が外部残高より多い(事後編集等)場合はdifferenceが負で不一致', () => {
    const result = checkBalanceReconciliation([{ side: 'debit', amount: 10500 }], 9850)

    expect(result.bookBalance).toBe(10500)
    expect(result.difference).toBe(-650)
    expect(result.isReconciled).toBe(false)
  })

  it('対象行が0件の場合は帳簿残高0として計算する', () => {
    const result = checkBalanceReconciliation([], 0)

    expect(result.bookBalance).toBe(0)
    expect(result.isReconciled).toBe(true)
  })

  it('初期残高・残高調整・外部明細取込由来の複数行を借方/貸方合計として正しく積み上げる(1.5の絞り込み条件)', () => {
    const result = checkBalanceReconciliation(
      [
        { side: 'debit', amount: 100000 },
        { side: 'credit', amount: 3000 },
        { side: 'debit', amount: 250000 },
        { side: 'debit', amount: 800 },
      ],
      347800,
    )

    expect(result.bookBalance).toBe(347800)
    expect(result.isReconciled).toBe(true)
  })
})
