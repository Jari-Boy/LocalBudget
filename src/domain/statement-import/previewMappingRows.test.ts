/**
 * previewMappingRows(マッピング編集画面のプレビュー用、計画Issue #151、
 * docs/domain/statement-import.md 1.4)のユニットテスト。実際の取込と同じ変換
 * (mapRowsToImportedRecords)を行単位で適用し、読み取れない行を例外にせず理由つきで返すことを、
 * 符号付き1列・入金出金2列の両方、列の指定違い、日付・金額の読み取り失敗について検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { mapRowsToImportedRecords } from './mapRowsToImportedRecords'
import { previewMappingRows } from './previewMappingRows'

function definition(overrides: Partial<ImportMappingDefinition> = {}): ImportMappingDefinition {
  return {
    id: 1,
    accountIds: [],
    formatGroupId: 'test-bank',
    isSettled: null,
    label: 'テスト銀行',
    encoding: 'utf-8',
    delimiter: ',',
    headerRowCount: 1,
    dateColumn: '日付',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    debitColumn: null,
    creditColumn: null,
    balanceColumn: null,
    externalIdColumn: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const HEADER = ['日付', '摘要', '金額']

describe('previewMappingRows', () => {
  it('読み取れる行は実際の取込(mapRowsToImportedRecords)と同じレコードを返す', () => {
    const rows = [HEADER, ['2026/10/01', 'コンビニ', '-300'], ['2026/10/02', '給与', '250000']]

    const preview = previewMappingRows(rows, definition())

    expect(preview.columnError).toBeNull()
    expect(preview.rows.map((r) => r.record)).toEqual(mapRowsToImportedRecords(rows, definition()))
    expect(preview.rows.every((r) => r.error === null)).toBe(true)
  })

  it('入金・出金の2列形式では入金−出金が符号付き金額になる', () => {
    const rows = [
      ['日付', '摘要', '出金', '入金'],
      ['2026/10/01', 'ATM', '5,000', ''],
      ['2026/10/02', '給与', '', '250,000'],
    ]

    const preview = previewMappingRows(
      rows,
      definition({ amountMode: 'debit_credit_split', amountColumn: null, debitColumn: '出金', creditColumn: '入金' }),
    )

    expect(preview.rows.map((r) => r.record?.amount)).toEqual([-5000, 250000])
  })

  it('読み取れない行は例外にせず、行番号と理由を返し、ほかの行は読み取る', () => {
    const rows = [HEADER, ['2026/10/01', 'A', '100'], ['不正な日付', 'B', '200'], ['2026/10/03', 'C', 'abc']]

    const preview = previewMappingRows(rows, definition())

    expect(preview.rows.map((r) => r.record !== null)).toEqual([true, false, false])
    expect(preview.rows[1].rowNumber).toBe(3)
    expect(preview.rows[1].error).toBe('invalidDate')
    expect(preview.rows[2].error).toBe('invalidAmount')
  })

  it('各行に元のセル値を持たせる(元のCSVとの突き合わせ用)', () => {
    const rows = [HEADER, ['2026/10/01', 'A', '100']]

    expect(previewMappingRows(rows, definition()).rows[0].cells).toEqual(['2026/10/01', 'A', '100'])
  })

  it('指定した列が見つからない定義では、行は空でどの項目かをcolumnErrorで返す', () => {
    const rows = [HEADER, ['2026/10/01', 'A', '100']]

    const preview = previewMappingRows(rows, definition({ amountColumn: '存在しない列' }))

    expect(preview.rows).toEqual([])
    expect(preview.columnError).toEqual({ fieldName: 'amountColumn', columnSpec: '存在しない列' })
  })
})
