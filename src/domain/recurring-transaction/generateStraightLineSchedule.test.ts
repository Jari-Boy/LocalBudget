/**
 * generateStraightLineSchedule(定額法の償却の、回ごとの金額の生成補助)の純粋関数としてのユニットテスト。
 * 計画Issue #180の決定「(取得価額 − 残存価額) ÷ 回数で均等に割り、1円未満の端数は最終回に寄せ、
 * 合計が取得価額 − 残存価額と一致する。残存価額の既定は1円の備忘価額。税法の償却率は使わない」を検証する。
 * 外部依存なし(DB非依存)。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_RESIDUAL_VALUE, generateStraightLineSchedule } from './generateStraightLineSchedule'

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0)

describe('generateStraightLineSchedule', () => {
  it('割り切れるときは、毎回同じ金額になる(10万円・残存価額1円ではなく0円・4回)', () => {
    expect(generateStraightLineSchedule({ acquisitionCost: 100000, residualValue: 0, rounds: 4 })).toEqual([
      25000, 25000, 25000, 25000,
    ])
  })

  it('残存価額の既定は1円の備忘価額で、合計は 取得価額 − 1 になる', () => {
    expect(DEFAULT_RESIDUAL_VALUE).toBe(1)

    const amounts = generateStraightLineSchedule({ acquisitionCost: 100000, rounds: 5 })

    expect(sum(amounts)).toBe(99999)
  })

  it('1円未満の端数は最終回に寄せる(99,999円を5回なら、19,999円×4回と最終回20,003円)', () => {
    const amounts = generateStraightLineSchedule({ acquisitionCost: 100000, rounds: 5 })

    expect(amounts.slice(0, 4)).toEqual([19999, 19999, 19999, 19999])
    expect(amounts[4]).toBe(20003)
  })

  it('合計は常に「取得価額 − 残存価額」と一致する', () => {
    for (const [cost, residual, rounds] of [
      [123456, 1, 7],
      [1000, 1, 3],
      [50000, 0, 12],
      [10, 1, 9],
    ] as const) {
      expect(sum(generateStraightLineSchedule({ acquisitionCost: cost, residualValue: residual, rounds }))).toBe(
        cost - residual,
      )
    }
  })

  it('1回だけなら、全額を1回で償却する', () => {
    expect(generateStraightLineSchedule({ acquisitionCost: 5000, residualValue: 1, rounds: 1 })).toEqual([4999])
  })

  it('回数が1以上の整数でない、取得価額が残存価額以下、残存価額が負のときはエラーにする', () => {
    expect(() => generateStraightLineSchedule({ acquisitionCost: 1000, rounds: 0 })).toThrow()
    expect(() => generateStraightLineSchedule({ acquisitionCost: 1000, rounds: 1.5 })).toThrow()
    expect(() => generateStraightLineSchedule({ acquisitionCost: 1, residualValue: 1, rounds: 3 })).toThrow()
    expect(() => generateStraightLineSchedule({ acquisitionCost: 1000, residualValue: -1, rounds: 3 })).toThrow()
  })
})
