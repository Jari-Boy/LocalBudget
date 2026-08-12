/**
 * resolveMappingDefinitionCandidates(候補マッピング定義それぞれへの実パース試行による絞り込み、
 * 計画Issue #78、docs/domain/statement-import.md 1.4・1.5手順1)の純粋関数としてのユニットテスト。
 * CSVバイト列と候補定義配列を受け取り、候補ごとにreadCsv→mapRowsToImportedRecordsを試みて
 * エラーなく成功したものだけを返すことを検証する。候補ごとにencoding/delimiterが異なりうる点、
 * MappingColumnNotFoundError以外の汎用Errorも同様に失敗として扱われる点を含む。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { resolveMappingDefinitionCandidates } from './resolveMappingDefinitionCandidates'

function definition(overrides: Partial<ImportMappingDefinition> = {}): ImportMappingDefinition {
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

function bytesOf(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

describe('resolveMappingDefinitionCandidates', () => {
  it('候補が0件の場合、空配列を返す', () => {
    const result = resolveMappingDefinitionCandidates(bytesOf('2026/07/20,セブンイレブン,-150\n'), [])
    expect(result).toEqual([])
  })

  it('列インデックス指定で実際にパースできる候補のみ、パース結果(rows)付きで返す', () => {
    const good = definition({ id: 1, label: '列インデックス指定' })
    const bytes = bytesOf('2026/07/20,セブンイレブン,-150\n')

    const result = resolveMappingDefinitionCandidates(bytes, [good])

    expect(result).toEqual([{ definition: good, rows: [['2026/07/20', 'セブンイレブン', '-150']] }])
  })

  it('列が見つからない候補(MappingColumnNotFoundError)は除外される', () => {
    const missingColumn = definition({
      id: 2,
      label: 'ヘッダー名指定(不一致)',
      headerRowCount: 1,
      dateColumn: '日付',
      descriptionColumn: '摘要',
      amountColumn: '金額',
    })
    const bytes = bytesOf('違う列1,違う列2,違う列3\na,b,c\n')

    const result = resolveMappingDefinitionCandidates(bytes, [missingColumn])

    expect(result).toEqual([])
  })

  it('日付・金額のパースに失敗する候補(汎用Error)も、種類を問わず除外される', () => {
    const wrongDelimiter = definition({
      id: 3,
      label: '区切り文字が異なる候補',
      delimiter: '\t',
    })
    // カンマ区切りのCSVをタブ区切りとして読むと1行1列にまとまり、日付書式に一致しない
    const bytes = bytesOf('2026/07/20,セブンイレブン,-150\n')

    const result = resolveMappingDefinitionCandidates(bytes, [wrongDelimiter])

    expect(result).toEqual([])
  })

  it('複数の候補がいずれもパースに成功する場合、入力順を保ったまま全て返す', () => {
    const first = definition({ id: 1, label: '候補1' })
    const second = definition({ id: 2, label: '候補2' })
    const bytes = bytesOf('2026/07/20,セブンイレブン,-150\n')

    const result = resolveMappingDefinitionCandidates(bytes, [first, second])

    expect(result.map((match) => match.definition.id)).toEqual([1, 2])
  })

  it('候補ごとにencoding/delimiterが異なっていても、それぞれの設定でreadCsvが個別実行される', () => {
    const commaDefinition = definition({ id: 1, label: 'カンマ区切り', delimiter: ',' })
    const tabDefinition = definition({ id: 2, label: 'タブ区切り', delimiter: '\t' })
    const bytes = bytesOf('2026/07/20\tセブンイレブン\t-150\n')

    const result = resolveMappingDefinitionCandidates(bytes, [commaDefinition, tabDefinition])

    expect(result).toEqual([
      { definition: tabDefinition, rows: [['2026/07/20', 'セブンイレブン', '-150']] },
    ])
  })

  it('パースに成功する候補が1件もない場合、空配列を返す', () => {
    const onlyBadCandidate = definition({
      id: 1,
      label: '不一致な候補',
      headerRowCount: 1,
      dateColumn: '日付',
    })
    const bytes = bytesOf('違う列\na\n')

    const result = resolveMappingDefinitionCandidates(bytes, [onlyBadCandidate])

    expect(result).toEqual([])
  })
})
