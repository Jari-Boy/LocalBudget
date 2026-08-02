/**
 * 通貨最小単位の整数値(例: 日本円なら1円単位、米ドルなら1セント単位)を
 * ロケールに応じた表示用文字列へ変換するformatCurrencyのユニットテスト。
 * ドメイン層は金額を通貨最小単位の整数値としてのみ保持し(docs/architecture.md
 * 13章、docs/domain/journal.md 1.4)、表示直前にのみこの変換を適用する方針を
 * 検証する。ISO 4217準拠で通貨ごとに小数桁数(exponent)が異なる点
 * (JPYは0桁、USDは2桁)を正しく扱えることを重点的に確認する。外部依存なし。
 */
import { describe, expect, test } from 'vitest'
import { formatCurrency } from './formatCurrency'

describe('formatCurrency', () => {
  test('JPY(小数桁0)の場合、最小単位の整数値がそのまま表示金額になる', () => {
    expect(formatCurrency(1000, 'JPY')).toBe(
      new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(1000),
    )
  })

  test('USD(小数桁2)の場合、最小単位(セント)が小数点2桁の表示金額に変換される', () => {
    expect(formatCurrency(1050, 'USD')).toBe(
      new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'USD' }).format(10.5),
    )
  })

  test('小数桁が生じる通貨で、最小単位1に対して桁がずれないこと(1セント=0.01ドル)', () => {
    expect(formatCurrency(1, 'USD')).toBe(
      new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'USD' }).format(0.01),
    )
  })

  test('ロケールを明示的に指定した場合はそのロケールでフォーマットされる', () => {
    expect(formatCurrency(1050, 'USD', 'en-US')).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(10.5),
    )
  })
})
