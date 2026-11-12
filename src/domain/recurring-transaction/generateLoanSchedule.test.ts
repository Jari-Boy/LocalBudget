/**
 * generateLoanSchedule(元利均等・元金均等のローンの、回ごとの元金・利息・返済額の生成補助)の純粋関数としての
 * ユニットテスト。計画Issue #180の決定を検証する: 毎月の利息は「残高 × 年利 ÷ 12」で1円未満切り捨て、
 * 元利均等の毎月の返済額は1円未満切り上げ、最終回で端数を調整して元金の合計が借入額と一致する。
 * 日割りの利息は扱わない。年利は0.01%単位(整数のベーシスポイントに直して計算し、浮動小数の誤差を避ける)。
 * 外部依存なし(DB非依存)。
 */
import { describe, expect, it } from 'vitest'
import { generateLoanSchedule } from './generateLoanSchedule'

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0)

describe('generateLoanSchedule(元利均等)', () => {
  const rows = generateLoanSchedule({ principal: 1000000, annualRatePercent: 1.2, rounds: 12, method: 'annuity' })

  it('回数分の行を返し、元金の合計が借入額と一致する', () => {
    expect(rows).toHaveLength(12)
    expect(sum(rows.map((r) => r.principal))).toBe(1000000)
  })

  it('1回目の利息は 借入額 × 年利 ÷ 12 の1円未満切り捨て(100万円・1.2% → 1,000円)', () => {
    expect(rows[0].interest).toBe(1000)
  })

  it('最終回の手前まで、毎月の返済額(元金+利息)は同じ(1円未満切り上げた額)になる', () => {
    const payments = rows.slice(0, -1).map((r) => r.principal + r.interest)

    expect(new Set(payments).size).toBe(1)
    // 100万円・年1.2%・12回の元利均等の返済額は 83,875.99... なので切り上げて83,876円
    expect(payments[0]).toBe(83876)
  })

  it('最終回は端数を調整して、残高がちょうど0になる(元金は残りの残高全額)', () => {
    const last = rows[rows.length - 1]
    const principalBeforeLast = sum(rows.slice(0, -1).map((r) => r.principal))

    expect(last.principal).toBe(1000000 - principalBeforeLast)
  })

  it('利息は毎回、その時点の残高から1円未満切り捨てで求める', () => {
    let balance = 1000000
    for (const row of rows) {
      expect(row.interest).toBe(Math.floor((balance * 120) / 120000))
      balance -= row.principal
    }
    expect(balance).toBe(0)
  })

  it('年利0%なら利息は0で、元金は均等(切り上げ)に返し、最終回で調整する', () => {
    const zero = generateLoanSchedule({ principal: 1000, annualRatePercent: 0, rounds: 3, method: 'annuity' })

    expect(zero.map((r) => r.interest)).toEqual([0, 0, 0])
    expect(zero.map((r) => r.principal)).toEqual([334, 334, 332])
  })

  it('3,000万円・年1.2%・120回でも、元金の合計が借入額と一致し、浮動小数の誤差で利息がずれない(1回目 30,000円)', () => {
    const big = generateLoanSchedule({ principal: 30000000, annualRatePercent: 1.2, rounds: 120, method: 'annuity' })

    expect(big[0].interest).toBe(30000)
    expect(sum(big.map((r) => r.principal))).toBe(30000000)
  })
})

describe('generateLoanSchedule(元金均等)', () => {
  const rows = generateLoanSchedule({ principal: 1000000, annualRatePercent: 1.2, rounds: 12, method: 'equal_principal' })

  it('元金は毎回 借入額÷回数(1円未満切り捨て)で、端数は最終回に寄せて合計が借入額と一致する', () => {
    expect(rows.slice(0, -1).every((r) => r.principal === 83333)).toBe(true)
    expect(rows[11].principal).toBe(1000000 - 83333 * 11)
    expect(sum(rows.map((r) => r.principal))).toBe(1000000)
  })

  it('利息は残高に応じて毎回減っていく(1回目 1,000円、2回目は残高916,667円から916円)', () => {
    expect(rows[0].interest).toBe(1000)
    expect(rows[1].interest).toBe(916)
  })
})

describe('generateLoanSchedule(入力の検証)', () => {
  it('借入額・回数が正の整数でない、年利が負のときはエラーにする', () => {
    expect(() => generateLoanSchedule({ principal: 0, annualRatePercent: 1, rounds: 12, method: 'annuity' })).toThrow()
    expect(() => generateLoanSchedule({ principal: 1000, annualRatePercent: 1, rounds: 0, method: 'annuity' })).toThrow()
    expect(() => generateLoanSchedule({ principal: 1000, annualRatePercent: -1, rounds: 12, method: 'annuity' })).toThrow()
  })
})
