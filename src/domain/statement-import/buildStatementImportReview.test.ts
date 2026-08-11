/**
 * CSV取込レビュー画面(計画Issue #76)向けに、readCsvが返した生データを
 * ImportMappingDefinitionで変換し、重複防止フロー(docs/domain/statement-import.md 1.6)の
 * 判定結果を1レコードずつ付与するbuildStatementImportReviewのユニットテスト。
 * readCsv・mapRowsToImportedRecords・duplicateDetectionの各純粋関数を組み合わせる
 * オーケストレーション層であり、DB非依存・外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildStatementImportReview } from './buildStatementImportReview'
import type { ImportMappingDefinition } from './ImportMappingDefinition'
import type { ExistingTransactionSummary } from './duplicateDetection'

function definition(overrides: Partial<ImportMappingDefinition> = {}): ImportMappingDefinition {
  return {
    id: 1,
    accountId: 10,
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
    balanceColumn: '残高',
    externalIdColumn: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const APPROXIMATE_OPTIONS = { maxDateDiffDays: 3, maxAmountDiff: 100 }

describe('buildStatementImportReview', () => {
  it('rowsをImportedRecordへ変換し、各レコードに外部取引IDと重複判定結果を付与する', () => {
    const rows = [
      ['日付', '摘要', '金額', '残高'],
      ['2026/07/20', 'スーパー', '-3000', '97000'],
      ['2026/07/21', '給与', '250000', '347000'],
    ]

    const result = buildStatementImportReview({
      rows,
      definition: definition(),
      existingExternalIds: new Set(),
      existingTransactions: [],
      approximateDuplicateOptions: APPROXIMATE_OPTIONS,
    })

    expect(result.records).toHaveLength(2)
    expect(result.records[0].record.description).toBe('スーパー')
    expect(result.records[0].record.amount).toBe(-3000)
    expect(result.records[0].externalId).not.toBe('')
    expect(result.records[0].isExactDuplicate).toBe(false)
    expect(result.records[0].approximateCandidates).toEqual([])
  })

  it('既存の外部取引IDと一致するレコードはisExactDuplicate=trueになる', () => {
    const rows = [
      ['日付', '摘要', '金額', '残高'],
      ['2026/07/20', 'スーパー', '-3000', '97000'],
    ]

    const result = buildStatementImportReview({
      rows,
      definition: definition({ externalIdColumn: null }),
      existingExternalIds: new Set(['dummy']),
      existingTransactions: [],
      approximateDuplicateOptions: APPROXIMATE_OPTIONS,
    })

    // externalIdColumnが無いためハッシュ生成される。実際に生成された値を既存集合に含めて再検証する。
    const generatedId = result.records[0].externalId
    const dupResult = buildStatementImportReview({
      rows,
      definition: definition({ externalIdColumn: null }),
      existingExternalIds: new Set([generatedId]),
      existingTransactions: [],
      approximateDuplicateOptions: APPROXIMATE_OPTIONS,
    })

    expect(dupResult.records[0].isExactDuplicate).toBe(true)
  })

  it('日付・金額が近い既存明細があれば確定版候補としてapproximateCandidatesに含める', () => {
    const rows = [
      ['日付', '摘要', '金額', '残高'],
      ['2026/07/22', 'カード利用', '-5010', '94990'],
    ]
    const existing: ExistingTransactionSummary = {
      journalEntryId: 42,
      entryDate: '2026-07-20',
      amount: -5000,
      isSettled: false,
    }

    const result = buildStatementImportReview({
      rows,
      definition: definition({ externalIdColumn: null }),
      existingExternalIds: new Set(),
      existingTransactions: [existing],
      approximateDuplicateOptions: APPROXIMATE_OPTIONS,
    })

    expect(result.records[0].approximateCandidates).toEqual([existing])
  })

  it('balance_afterが取得できる最後のレコードの値をlatestExternalBalanceとして返す', () => {
    const rows = [
      ['日付', '摘要', '金額', '残高'],
      ['2026/07/20', 'スーパー', '-3000', '97000'],
      ['2026/07/21', '給与', '250000', '347000'],
    ]

    const result = buildStatementImportReview({
      rows,
      definition: definition(),
      existingExternalIds: new Set(),
      existingTransactions: [],
      approximateDuplicateOptions: APPROXIMATE_OPTIONS,
    })

    expect(result.latestExternalBalance).toBe(347000)
  })

  it('マッピング定義にbalanceColumnが無ければlatestExternalBalanceはnullになる', () => {
    const rows = [
      ['日付', '摘要', '金額'],
      ['2026/07/20', 'スーパー', '-3000'],
    ]

    const result = buildStatementImportReview({
      rows,
      definition: definition({ balanceColumn: null }),
      existingExternalIds: new Set(),
      existingTransactions: [],
      approximateDuplicateOptions: APPROXIMATE_OPTIONS,
    })

    expect(result.latestExternalBalance).toBeNull()
  })

  it('列構成が定義と一致しない場合はMappingColumnNotFoundErrorをそのまま伝播する', () => {
    const rows = [
      ['違うヘッダー1', '違うヘッダー2'],
      ['a', 'b'],
    ]

    expect(() =>
      buildStatementImportReview({
        rows,
        definition: definition(),
        existingExternalIds: new Set(),
        existingTransactions: [],
        approximateDuplicateOptions: APPROXIMATE_OPTIONS,
      }),
    ).toThrow('import mapping column not found')
  })
})
