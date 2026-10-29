/**
 * allocateSettlementToLines(1回の精算額を、複数の未消込の明細行へ先頭から順に割り当てる関数)の
 * 純粋関数としてのユニットテスト。1つの精算(消込)仕訳の一時勘定行から、複数の消込先の明細行へ
 * リンクを張る際(docs/domain/settlement.md 1.7のN:N)の金額の割り当てを、全額消込・一部消込・
 * 複数行にまたがる消込・過剰消込・候補なしを含めて検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { allocateSettlementToLines } from './allocateSettlementToLines'

describe('allocateSettlementToLines', () => {
  it('精算額が1行の残高以内なら、その行だけに全額を割り当てる', () => {
    expect(allocateSettlementToLines([{ lineId: 1, balance: 5000 }], 3000)).toEqual([{ toLineId: 1, amount: 3000 }])
  })

  it('精算額が先頭の行の残高を超える場合は、先頭から順に残高の上限まで割り当てる', () => {
    const result = allocateSettlementToLines(
      [
        { lineId: 1, balance: 5000 },
        { lineId: 2, balance: 4000 },
        { lineId: 3, balance: 3000 },
      ],
      7000,
    )

    expect(result).toEqual([
      { toLineId: 1, amount: 5000 },
      { toLineId: 2, amount: 2000 },
    ])
  })

  it('割り当てが0円になる後ろの行は結果に含めない', () => {
    const result = allocateSettlementToLines(
      [
        { lineId: 1, balance: 5000 },
        { lineId: 2, balance: 4000 },
      ],
      5000,
    )

    expect(result).toEqual([{ toLineId: 1, amount: 5000 }])
  })

  it('精算額が全行の残高の合計を超える過剰消込の場合は、超過分を最後の行に上乗せして全額をリンクに反映する', () => {
    const result = allocateSettlementToLines(
      [
        { lineId: 1, balance: 5000 },
        { lineId: 2, balance: 4000 },
      ],
      10000,
    )

    expect(result).toEqual([
      { toLineId: 1, amount: 5000 },
      { toLineId: 2, amount: 5000 },
    ])
  })

  it('候補の行がない場合は空配列を返す', () => {
    expect(allocateSettlementToLines([], 3000)).toEqual([])
  })

  it('精算額が0以下の場合は空配列を返す', () => {
    expect(allocateSettlementToLines([{ lineId: 1, balance: 5000 }], 0)).toEqual([])
  })
})
