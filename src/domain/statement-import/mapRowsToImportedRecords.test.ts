/**
 * mapRowsToImportedRecords(マッピング定義に基づく変換、docs/domain/statement-import.md 1.4)の
 * 純粋関数としてのユニットテスト。「行×列」の生データ+ImportMappingDefinitionから
 * ImportedRecord[]への変換を、列インデックス指定・ヘッダー名指定の両方、
 * amount_mode(single_signed/debit_credit_split)両方、日付書式変換、列不一致時のエラーを含めて検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { mapRowsToImportedRecords } from './mapRowsToImportedRecords'
import { MappingColumnNotFoundError } from './MappingColumnNotFoundError'

function baseDefinition(overrides: Partial<ImportMappingDefinition> = {}): ImportMappingDefinition {
  return {
    id: 1,
    accountId: null,
    formatGroupId: 'test-bank',
    isSettled: null,
    label: 'テスト銀行',
    encoding: 'utf-8',
    delimiter: ',',
    headerRowCount: 0,
    dateColumn: '0',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '1',
    amountMode: 'single_signed',
    amountColumn: '2',
    debitColumn: null,
    creditColumn: null,
    balanceColumn: null,
    externalIdColumn: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('列インデックス指定', () => {
  it('ヘッダー行なし・列インデックス指定でImportedRecord[]へ変換する', () => {
    const rows = [
      ['2026/07/20', 'セブンイレブン', '-150'],
      ['2026/07/21', '給与振込', '250000'],
    ]

    const records = mapRowsToImportedRecords(rows, baseDefinition())

    expect(records).toEqual([
      {
        entryDate: '2026-07-20',
        description: 'セブンイレブン',
        amount: -150,
        balanceAfter: null,
        externalId: null,
        isSettled: null,
      },
      {
        entryDate: '2026-07-21',
        description: '給与振込',
        amount: 250000,
        balanceAfter: null,
        externalId: null,
        isSettled: null,
      },
    ])
  })
})

describe('ヘッダー名指定', () => {
  it('headerRowCount=1でヘッダー行の列名からインデックスを解決する', () => {
    const rows = [
      ['取引日', '摘要', '金額', '残高', '管理番号'],
      ['2026/07/20', 'セブンイレブン', '-150', '9850', 'TX-001'],
    ]
    const definition = baseDefinition({
      headerRowCount: 1,
      dateColumn: '取引日',
      descriptionColumn: '摘要',
      amountColumn: '金額',
      balanceColumn: '残高',
      externalIdColumn: '管理番号',
      isSettled: true,
    })

    const records = mapRowsToImportedRecords(rows, definition)

    expect(records).toEqual([
      {
        entryDate: '2026-07-20',
        description: 'セブンイレブン',
        amount: -150,
        balanceAfter: 9850,
        externalId: 'TX-001',
        isSettled: true,
      },
    ])
  })

  it('headerRowCount=2の場合、最後のスキップ行(先頭注記行の次)をヘッダー行として使う', () => {
    const rows = [
      ['ご利用明細のご案内'],
      ['取引日', '摘要', '金額'],
      ['2026/07/20', 'セブンイレブン', '-150'],
    ]
    const definition = baseDefinition({
      headerRowCount: 2,
      dateColumn: '取引日',
      descriptionColumn: '摘要',
      amountColumn: '金額',
    })

    const records = mapRowsToImportedRecords(rows, definition)

    expect(records).toEqual([
      {
        entryDate: '2026-07-20',
        description: 'セブンイレブン',
        amount: -150,
        balanceAfter: null,
        externalId: null,
        isSettled: null,
      },
    ])
  })

  it('マッピング定義が指定する列名がCSVのヘッダーに存在しない場合MappingColumnNotFoundErrorを投げる', () => {
    const rows = [
      ['日付', '摘要', '金額'],
      ['2026/07/20', 'セブンイレブン', '-150'],
    ]
    const definition = baseDefinition({
      headerRowCount: 1,
      dateColumn: '取引日',
      descriptionColumn: '摘要',
      amountColumn: '金額',
    })

    expect(() => mapRowsToImportedRecords(rows, definition)).toThrow(MappingColumnNotFoundError)
  })

  it('headerRowCount=0でヘッダー名指定するとMappingColumnNotFoundErrorを投げる(インデックス指定のみ使用可)', () => {
    const rows = [['2026/07/20', 'セブンイレブン', '-150']]
    const definition = baseDefinition({ headerRowCount: 0, dateColumn: '取引日' })

    expect(() => mapRowsToImportedRecords(rows, definition)).toThrow(MappingColumnNotFoundError)
  })
})

describe('amount_mode = debit_credit_split', () => {
  it('入金額列のみ値がある場合は正の金額になる', () => {
    const rows = [['2026/07/21', '給与振込', '', '250000']]
    const definition = baseDefinition({
      amountMode: 'debit_credit_split',
      amountColumn: null,
      debitColumn: '2',
      creditColumn: '3',
    })

    const records = mapRowsToImportedRecords(rows, definition)

    expect(records[0].amount).toBe(250000)
  })

  it('出金額列のみ値がある場合は負の金額になる', () => {
    const rows = [['2026/07/20', 'セブンイレブン', '150', '']]
    const definition = baseDefinition({
      amountMode: 'debit_credit_split',
      amountColumn: null,
      debitColumn: '2',
      creditColumn: '3',
    })

    const records = mapRowsToImportedRecords(rows, definition)

    expect(records[0].amount).toBe(-150)
  })
})

describe('日付書式の変換', () => {
  it('YYYY-MM-DD形式もISO形式として変換できる', () => {
    const rows = [['2026-07-20', 'x', '100']]
    const definition = baseDefinition({ dateFormat: 'YYYY-MM-DD' })

    const records = mapRowsToImportedRecords(rows, definition)

    expect(records[0].entryDate).toBe('2026-07-20')
  })

  it('月日が1桁のフォーマットも0埋めしてISO形式に変換する', () => {
    const rows = [['2026/7/1', 'x', '100']]
    const definition = baseDefinition({ dateFormat: 'YYYY/M/D' })

    const records = mapRowsToImportedRecords(rows, definition)

    expect(records[0].entryDate).toBe('2026-07-01')
  })
})

describe('金額の桁区切りカンマ', () => {
  it('金額セルにカンマ区切りが含まれていても正しく数値化する', () => {
    const rows = [['2026/07/21', '給与振込', '250,000']]

    const records = mapRowsToImportedRecords(rows, baseDefinition())

    expect(records[0].amount).toBe(250000)
  })
})
