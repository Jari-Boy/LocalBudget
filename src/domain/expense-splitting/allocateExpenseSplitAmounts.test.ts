/**
 * allocateExpenseSplitAmounts(複数人割勘の按分計算)の純粋関数としてのユニットテスト。
 * 総額を分担者ごとの比率(weight)に応じて配分し、割り切れない端数は立替者(payerKey)の
 * 配分額に寄せて吸収するルール(計画Issue #40、比率変更・複数人対応)を、均等割・
 * カスタム比率・3人以上への分割・端数が生じないケースを含めて検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { allocateExpenseSplitAmounts } from './allocateExpenseSplitAmounts'

describe('allocateExpenseSplitAmounts', () => {
  it('均等割(重み1:1)で2人に按分し、端数が出ない場合はそのまま等分する', () => {
    const result = allocateExpenseSplitAmounts(1000, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 1 },
    ], 'A')

    expect(result).toEqual(new Map([
      ['A', 500],
      ['B', 500],
    ]))
  })

  it('均等割(重み1:1:1)で3人に按分し、割り切れない端数は立替者に寄せる', () => {
    const result = allocateExpenseSplitAmounts(1000, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 1 },
      { key: 'C', weight: 1 },
    ], 'A')

    // 1000 / 3 = 333.33... なので B・Cは333円ずつ、端数の334円はAに寄る
    expect(result).toEqual(new Map([
      ['A', 334],
      ['B', 333],
      ['C', 333],
    ]))
    const total = Array.from(result.values()).reduce((sum, amount) => sum + amount, 0)
    expect(total).toBe(1000)
  })

  it('カスタム比率(5:3:2)で按分する', () => {
    const result = allocateExpenseSplitAmounts(1000, [
      { key: 'A', weight: 5 },
      { key: 'B', weight: 3 },
      { key: 'C', weight: 2 },
    ], 'A')

    expect(result).toEqual(new Map([
      ['A', 500],
      ['B', 300],
      ['C', 200],
    ]))
  })

  it('立替者が分担者の先頭以外にいても、端数は立替者に寄せる', () => {
    const result = allocateExpenseSplitAmounts(1000, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 1 },
      { key: 'C', weight: 1 },
    ], 'C')

    expect(result).toEqual(new Map([
      ['A', 333],
      ['B', 333],
      ['C', 334],
    ]))
  })

  it('4人以上への按分でも合計が総額と一致する', () => {
    const result = allocateExpenseSplitAmounts(1001, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 1 },
      { key: 'C', weight: 1 },
      { key: 'D', weight: 1 },
    ], 'A')

    const total = Array.from(result.values()).reduce((sum, amount) => sum + amount, 0)
    expect(total).toBe(1001)
    expect(result.get('A')).toBeGreaterThan(0)
  })
})
