/**
 * 複数CSVの一括取込(計画Issue #214)向けのbuildMultiFileStatementImportReviewのユニットテスト。
 * 各ファイルを期間(最も早い取引日)の早い順に並べ、外部取引IDの代替ハッシュをファイル単位で算出したうえで、
 * ファイル間で外部取引IDが一致する行を、先のファイルを残して「ファイル間の重複」として対象外にする
 * (docs/domain/statement-import.md 1.6)ことを検証する。取込済みとの突合・確定版候補・読み取れない行の
 * ファイル名付与も含む。1ファイルだけのときは従来のbuildStatementImportReviewと同じ結果になる。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildMultiFileStatementImportReview } from './buildMultiFileStatementImportReview'
import { buildStatementImportReview } from './buildStatementImportReview'
import type { ImportMappingDefinition } from './ImportMappingDefinition'

function definition(): ImportMappingDefinition {
  return {
    id: 1,
    accountIds: [10],
    formatGroupId: 'test-card',
    isSettled: null,
    label: 'テストカード',
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
    invertAmountSign: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const HEADER = ['日付', '摘要', '金額']
const OPTIONS = { maxDateDiffDays: 3, maxAmountDiff: 100 }

function build(files: Array<{ fileName: string; rows: string[][] }>, existingExternalIds: ReadonlySet<string> = new Set()) {
  return buildMultiFileStatementImportReview({
    files,
    definition: definition(),
    existingExternalIds,
    existingTransactions: [],
    approximateDuplicateOptions: OPTIONS,
  })
}

describe('buildMultiFileStatementImportReview', () => {
  it('1ファイルだけのときは、従来のbuildStatementImportReviewと同じ並び・同じ判定になる', () => {
    const rows = [HEADER, ['2025/10/05', 'B', '-200'], ['2025/10/01', 'A', '-100']]
    const single = buildStatementImportReview({
      rows,
      definition: definition(),
      existingExternalIds: new Set(),
      existingTransactions: [],
      approximateDuplicateOptions: OPTIONS,
    })

    const multi = build([{ fileName: 'a.csv', rows }])

    expect(multi.records.map((r) => r.record)).toEqual(single.records.map((r) => r.record))
    expect(multi.records.map((r) => r.externalId)).toEqual(single.records.map((r) => r.externalId))
    expect(multi.records.every((r) => r.crossFileDuplicateOf === null)).toBe(true)
  })

  it('各行にファイル名と、CSV上の行番号が付く', () => {
    const result = build([{ fileName: 'a.csv', rows: [HEADER, ['2025/10/01', 'A', '-100']] }])

    expect(result.records[0].fileName).toBe('a.csv')
    expect(result.records[0].sourceRowNumber).toBe(2)
  })

  it('複数ファイルは期間の早い順に並べ、連結後は日付順になる(選択順に依存しない)', () => {
    const october = { fileName: 'oct.csv', rows: [HEADER, ['2025/10/20', 'C', '-300'], ['2025/10/02', 'A', '-100']] }
    const september = { fileName: 'sep.csv', rows: [HEADER, ['2025/09/15', 'S', '-50']] }

    const result = build([october, september])

    expect(result.files.map((f) => f.fileName)).toEqual(['sep.csv', 'oct.csv'])
    expect(result.records.map((r) => r.record.entryDate)).toEqual(['2025-09-15', '2025-10-02', '2025-10-20'])
  })

  it('各ファイルの期間と件数を返す', () => {
    const result = build([
      { fileName: 'oct.csv', rows: [HEADER, ['2025/10/20', 'C', '-300'], ['2025/10/02', 'A', '-100']] },
    ])

    expect(result.files).toEqual([
      { fileName: 'oct.csv', periodStart: '2025-10-02', periodEnd: '2025-10-20', recordCount: 2 },
    ])
  })

  it('期間が重なるファイルの同じ明細は、先(期間が早い)のファイルを残し、後のファイルの行をファイル間の重複にする', () => {
    const october = { fileName: 'oct.csv', rows: [HEADER, ['2025/10/01', 'A', '-100'], ['2025/10/26', 'Amazon', '-2980']] }
    const preview = { fileName: 'nov.csv', rows: [HEADER, ['2025/10/26', 'Amazon', '-2980'], ['2025/11/03', 'D', '-400']] }

    const result = build([preview, october])

    const amazon = result.records.filter((r) => r.record.description === 'Amazon')
    expect(amazon).toHaveLength(2)
    expect(amazon[0].fileName).toBe('oct.csv')
    expect(amazon[0].crossFileDuplicateOf).toBeNull()
    expect(amazon[1].fileName).toBe('nov.csv')
    expect(amazon[1].isExactDuplicate).toBe(true)
    expect(amazon[1].crossFileDuplicateOf).toBe(result.records.indexOf(amazon[0]))
  })

  it('重なる分の件数が違っても、同日・同額・同摘要の正当な複数明細を落とさず、重なる分だけを重複にする', () => {
    // 10月ファイルにはセブンが1件、速報ファイルには同日・同額・同摘要が2件ある(2件目だけが速報にしかない)
    const october = { fileName: 'oct.csv', rows: [HEADER, ['2025/10/28', 'セブン', '-420']] }
    const preview = { fileName: 'nov.csv', rows: [HEADER, ['2025/10/28', 'セブン', '-420'], ['2025/10/28', 'セブン', '-420']] }

    const result = build([october, preview])

    const statuses = result.records.map((r) => (r.crossFileDuplicateOf === null ? 'new' : 'dup'))
    expect(statuses.filter((s) => s === 'new')).toHaveLength(2)
    expect(statuses.filter((s) => s === 'dup')).toHaveLength(1)
    expect(result.records.filter((r) => r.crossFileDuplicateOf === null).map((r) => r.fileName).sort()).toEqual(['nov.csv', 'oct.csv'])
  })

  it('同じファイル内の同日・同額・同摘要の2件は、ファイル間の重複にしない', () => {
    const result = build([
      { fileName: 'a.csv', rows: [HEADER, ['2025/10/28', 'セブン', '-420'], ['2025/10/28', 'セブン', '-420']] },
    ])

    expect(result.records.map((r) => r.crossFileDuplicateOf)).toEqual([null, null])
    expect(new Set(result.records.map((r) => r.externalId)).size).toBe(2)
  })

  it('ファイル間の重複行は、取り込むと選んだときにUNIQUE制約に当たらないよう、外部取引IDを別の値にする', () => {
    const a = { fileName: 'a.csv', rows: [HEADER, ['2025/10/01', 'A', '-100']] }
    const b = { fileName: 'b.csv', rows: [HEADER, ['2025/10/01', 'A', '-100']] }

    const result = build([a, b])

    expect(new Set(result.records.map((r) => r.externalId)).size).toBe(2)
  })

  it('取込済みの外部取引IDと一致する行は、ファイル間の重複とは別にisExactDuplicateになる', () => {
    const single = build([{ fileName: 'a.csv', rows: [HEADER, ['2025/10/01', 'A', '-100']] }])
    const existing = new Set([single.records[0].externalId])

    const result = build([{ fileName: 'a.csv', rows: [HEADER, ['2025/10/01', 'A', '-100']] }], existing)

    expect(result.records[0].isExactDuplicate).toBe(true)
    expect(result.records[0].crossFileDuplicateOf).toBeNull()
  })

  it('読み取れない行には、ファイル名と元のCSVの行番号が付く', () => {
    const result = build([
      { fileName: 'a.csv', rows: [HEADER, ['2025/10/01', 'A', '-100'], ['', '為替レート 148.5', '']] },
      { fileName: 'b.csv', rows: [HEADER, ['', 'ETC', ''], ['2025/11/01', 'B', '-1']] },
    ])

    expect(result.unreadableRows.map((r) => [r.fileName, r.rowNumber])).toEqual([
      ['a.csv', 3],
      ['b.csv', 2],
    ])
  })

  it('取り込める行が1件も無いファイルは、期間なしで件数0のファイルとして末尾に並ぶ', () => {
    const result = build([
      { fileName: 'empty.csv', rows: [HEADER] },
      { fileName: 'a.csv', rows: [HEADER, ['2025/10/01', 'A', '-100']] },
    ])

    expect(result.files.map((f) => f.fileName)).toEqual(['a.csv', 'empty.csv'])
    expect(result.files[1]).toEqual({ fileName: 'empty.csv', periodStart: null, periodEnd: null, recordCount: 0 })
  })
})
