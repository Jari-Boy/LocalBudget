/**
 * allocateSignedAcrossLines(1人の分担額を、符号付きの行の金額の比で各行へ配分する純粋関数、計画Issue #271)の
 * ユニットテスト。借方(+)と貸方(−)の行が混ざっても、配分額の合計が分担額と1円もずれないこと、
 * 端数が最大剰余法で配られること、全行が同じ向きのときは行の金額比になることを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { allocateSignedAcrossLines } from './allocateSignedAcrossLines'

describe('allocateSignedAcrossLines', () => {
  it('借方の行だけのときは、行の金額比で配分する', () => {
    expect(allocateSignedAcrossLines(1000, [2400, 1600])).toEqual([600, 400])
  })

  it('借方と貸方が混ざるときは、符号を保ったまま純額に対する割合で配分する', () => {
    // 純額 2400+1600-800-500 = 2700。相手の負担 1350(= 50%)なら各行の半分
    expect(allocateSignedAcrossLines(1350, [2400, 1600, -800, -500])).toEqual([1200, 800, -400, -250])
  })

  it('配分額の合計は端数があっても分担額と一致する', () => {
    const result = allocateSignedAcrossLines(1000, [2400, 1600, -800, -500])
    expect(result.reduce((sum, n) => sum + n, 0)).toBe(1000)
  })

  it('純額が負のとき(貸方が多いとき)は、負の分担額を各行へ配分する', () => {
    expect(allocateSignedAcrossLines(-300, [-800, 200])).toEqual([-400, 100])
  })

  it('行が1つなら分担額をそのまま返す', () => {
    expect(allocateSignedAcrossLines(700, [900])).toEqual([700])
  })
})
