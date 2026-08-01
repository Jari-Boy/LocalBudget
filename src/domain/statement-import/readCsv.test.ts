/**
 * readCsv(CSVの読み取り、docs/domain/statement-import.md 1.3)の純粋関数としてのユニットテスト。
 * 文字コード(UTF-8/Shift-JIS)・区切り文字(カンマ/タブ)・改行コードの違いを吸収し、
 * 「行×列」の生データ(文字列の二次元配列)へ変換することのみを検証する。列の意味の解釈
 * (日付か金額か等)は行わない(3章 責務分担)。DB非依存、外部依存はpapaparseのみ。
 */
import { describe, expect, it } from 'vitest'
import { readCsv } from './readCsv'

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('readCsv', () => {
  it('UTF-8・カンマ区切りのCSVを行×列の文字列配列へ変換する', () => {
    const bytes = utf8Bytes('2026/07/20,セブンイレブン,150\n2026/07/21,ファミリーマート,300\n')

    const rows = readCsv(bytes, { encoding: 'utf-8', delimiter: ',' })

    expect(rows).toEqual([
      ['2026/07/20', 'セブンイレブン', '150'],
      ['2026/07/21', 'ファミリーマート', '300'],
    ])
  })

  it('Shift-JISでエンコードされたCSVを正しくデコードする', () => {
    // 'あ,チャ' のShift-JISバイト列(カンマ区切り2列1行)
    const bytes = new Uint8Array([0x82, 0xa0, 0x2c, 0x83, 0x60, 0x83, 0x83])

    const rows = readCsv(bytes, { encoding: 'shift-jis', delimiter: ',' })

    expect(rows).toEqual([['あ', 'チャ']])
  })

  it('タブ区切りのCSVを読み取れる', () => {
    const bytes = utf8Bytes('2026/07/20\tセブンイレブン\t150')

    const rows = readCsv(bytes, { encoding: 'utf-8', delimiter: '\t' })

    expect(rows).toEqual([['2026/07/20', 'セブンイレブン', '150']])
  })

  it('CRLF改行を行区切りとして扱う', () => {
    const bytes = utf8Bytes('a,1\r\nb,2\r\n')

    const rows = readCsv(bytes, { encoding: 'utf-8', delimiter: ',' })

    expect(rows).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })

  it('空行はスキップする', () => {
    const bytes = utf8Bytes('a,1\n\nb,2\n')

    const rows = readCsv(bytes, { encoding: 'utf-8', delimiter: ',' })

    expect(rows).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })

  it('ダブルクォートで囲まれ区切り文字・改行を含むフィールドを1列として読み取る', () => {
    const bytes = utf8Bytes('"セブン,イレブン","日本橋店\n1号店",150')

    const rows = readCsv(bytes, { encoding: 'utf-8', delimiter: ',' })

    expect(rows).toEqual([['セブン,イレブン', '日本橋店\n1号店', '150']])
  })

  it('入力が空バイト列の場合は空配列を返す', () => {
    const rows = readCsv(new Uint8Array(), { encoding: 'utf-8', delimiter: ',' })

    expect(rows).toEqual([])
  })
})
