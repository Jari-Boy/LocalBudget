/**
 * inferEncoding(エンコーディングの推測、docs/domain/statement-import.md 1.3)の
 * 純粋関数としてのユニットテスト。CSVの生バイト列がUTF-8として厳密にデコードできるかどうかで
 * utf-8/shift-jisを判定することを検証する。列マッピングの推測(inferMappingDefinitionDraft)とは
 * 独立した別関数であり、まだ定義が存在しないドラフト生成時のブートストラップ用途に限定される
 * (1.3の「エンコーディングは明示的に指定する」原則の例外)。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { inferEncoding } from './inferEncoding'

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('inferEncoding', () => {
  it('UTF-8として妥当なバイト列はutf-8と判定する', () => {
    const bytes = utf8Bytes('2026/07/20,セブンイレブン,150\n')

    expect(inferEncoding(bytes)).toBe('utf-8')
  })

  it('Shift-JISでエンコードされたバイト列(UTF-8として不正)はshift-jisと判定する', () => {
    // 'あ,チャ' のShift-JISバイト列(readCsv.test.tsと同じ例)
    const bytes = new Uint8Array([0x82, 0xa0, 0x2c, 0x83, 0x60, 0x83, 0x83])

    expect(inferEncoding(bytes)).toBe('shift-jis')
  })

  it('ASCIIのみのバイト列はutf-8と判定する', () => {
    const bytes = utf8Bytes('2026/07/20,100\n')

    expect(inferEncoding(bytes)).toBe('utf-8')
  })

  it('空のバイト列はutf-8と判定する', () => {
    expect(inferEncoding(new Uint8Array())).toBe('utf-8')
  })
})
