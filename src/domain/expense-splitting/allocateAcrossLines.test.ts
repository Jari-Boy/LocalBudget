/**
 * allocateAcrossLines(1人の分担額を、費用の行の金額比で各行へ配分する純粋関数、計画Issue #149)の
 * ユニットテスト。端数は最大剰余法で配り、配分額の合計が分担額と1円もずれないことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { allocateAcrossLines } from './allocateAcrossLines'

describe('allocateAcrossLines', () => {
  it('行が1つなら分担額をそのまま返す', () => {
    expect(allocateAcrossLines(333, [1000])).toEqual([333])
  })

  it('行の金額比で按分する', () => {
    expect(allocateAcrossLines(500, [700, 300])).toEqual([350, 150])
  })

  it('割り切れない端数は小数部の大きい行から1円ずつ配り、合計が分担額と一致する', () => {
    // 100 * 1/3 = 33.33.. を3行 → 34 + 33 + 33(端数1円は先頭の行に寄せる)
    const result = allocateAcrossLines(100, [1000, 1000, 1000])

    expect(result.reduce((a, b) => a + b, 0)).toBe(100)
    expect(result).toEqual([34, 33, 33])
  })

  it('小数部が大きい行へ端数を配る', () => {
    // 10 を 3:3:4 の比 → 3.0 / 3.0 / 4.0 ではなく、101 を 1:1:1:... のような難しいケースで合計を確認
    const result = allocateAcrossLines(7, [10, 20, 30])

    expect(result.reduce((a, b) => a + b, 0)).toBe(7)
    expect(result).toEqual([1, 2, 4])
  })

  it('分担額が0なら全行0を返す', () => {
    expect(allocateAcrossLines(0, [700, 300])).toEqual([0, 0])
  })

  it('さまざまな金額・行数で合計が1円もずれない', () => {
    const lineSets = [[1], [1, 1], [333, 667], [1, 2, 3, 4, 5], [99999, 1, 12345], [500, 500, 500, 500, 500, 500, 500]]
    for (const lines of lineSets) {
      for (const total of [0, 1, 2, 7, 99, 100, 1001, 123456]) {
        const result = allocateAcrossLines(total, lines)
        expect(result.reduce((a, b) => a + b, 0)).toBe(total)
        expect(result.every((value) => Number.isInteger(value) && value >= 0)).toBe(true)
      }
    }
  })
})
