/**
 * getPreviousDayの純粋関数としてのユニットテスト。
 * BS比較機能(計画Issue #34)で、日付指定モード時の比較基準日入力欄に
 * 「基準日より前の日付」という制約(HTML `max`属性)を設定するために、
 * 基準日の前日を'YYYY-MM-DD'形式で返す。月初日・年初日をまたぐ繰り下がりを
 * 中心に検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { getPreviousDay } from './getPreviousDay'

describe('getPreviousDay', () => {
  it('通常の日付は1日前を返す', () => {
    expect(getPreviousDay('2026-07-15')).toBe('2026-07-14')
  })

  it('月初日の前日は前月の月末日になる', () => {
    expect(getPreviousDay('2026-07-01')).toBe('2026-06-30')
  })

  it('年初日の前日は前年の12月31日になる', () => {
    expect(getPreviousDay('2026-01-01')).toBe('2025-12-31')
  })

  it('うるう年3/1の前日は2/29になる', () => {
    expect(getPreviousDay('2028-03-01')).toBe('2028-02-29')
  })
})
