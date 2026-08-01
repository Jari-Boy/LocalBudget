/**
 * 重複防止フロー(docs/domain/statement-import.md 1.6)のうち、完全一致判定(partitionByExternalIdDuplicate)
 * と近似候補提示(findApproximateDuplicateCandidates)の純粋関数としてのユニットテスト。
 * 実際にexternal_transaction_refsを検索するRepository実装はA6(突合ドメイン)側のスコープであり、
 * ここでは「既存の外部取引ID集合/既存明細一覧」を引数として受け取る形で判定ロジックのみを検証する。
 * 近似判定の閾値(日数・金額差)はドメイン設計のスコープ外(1.6)のため、関数の引数として受け取り、
 * 値そのもののパラメータ化(UI設定等)は行わない。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  findApproximateDuplicateCandidates,
  partitionByExternalIdDuplicate,
  type ExistingTransactionSummary,
} from './duplicateDetection'
import type { ImportedRecord } from './ImportedRecord'

describe('partitionByExternalIdDuplicate(external_id完全一致判定)', () => {
  it('既存の外部取引IDと一致するものをduplicateIndicesに、一致しないものをnewIndicesに分類する', () => {
    const result = partitionByExternalIdDuplicate(
      ['TX-001', 'TX-002', 'TX-003'],
      new Set(['TX-001', 'TX-003']),
    )

    expect(result.duplicateIndices).toEqual([0, 2])
    expect(result.newIndices).toEqual([1])
  })

  it('既存の外部取引IDが空集合ならすべてnewIndicesになる', () => {
    const result = partitionByExternalIdDuplicate(['TX-001', 'TX-002'], new Set())

    expect(result.duplicateIndices).toEqual([])
    expect(result.newIndices).toEqual([0, 1])
  })

  it('externalIdsが空配列なら両方とも空配列になる', () => {
    const result = partitionByExternalIdDuplicate([], new Set(['TX-001']))

    expect(result.duplicateIndices).toEqual([])
    expect(result.newIndices).toEqual([])
  })
})

describe('findApproximateDuplicateCandidates(近似候補提示)', () => {
  function record(overrides: Partial<ImportedRecord> = {}): ImportedRecord {
    return {
      entryDate: '2026-07-20',
      description: 'カード利用',
      amount: -5000,
      balanceAfter: null,
      externalId: null,
      isSettled: null,
      ...overrides,
    }
  }

  function existing(overrides: Partial<ExistingTransactionSummary> = {}): ExistingTransactionSummary {
    return {
      journalEntryId: 1,
      entryDate: '2026-07-20',
      amount: -5000,
      isSettled: null,
      ...overrides,
    }
  }

  it('日付・金額の両方が閾値内の既存明細を候補として返す', () => {
    const target = record({ entryDate: '2026-07-22', amount: -5010 })
    const candidates = findApproximateDuplicateCandidates(
      target,
      [existing({ journalEntryId: 1, entryDate: '2026-07-20', amount: -5000 })],
      { maxDateDiffDays: 3, maxAmountDiff: 100 },
    )

    expect(candidates.map((c) => c.journalEntryId)).toEqual([1])
  })

  it('日付が閾値を超える既存明細は候補に含めない', () => {
    const target = record({ entryDate: '2026-07-30' })
    const candidates = findApproximateDuplicateCandidates(
      target,
      [existing({ entryDate: '2026-07-20' })],
      { maxDateDiffDays: 3, maxAmountDiff: 100 },
    )

    expect(candidates).toEqual([])
  })

  it('金額差が閾値を超える既存明細は候補に含めない', () => {
    const target = record({ amount: -5000 })
    const candidates = findApproximateDuplicateCandidates(
      target,
      [existing({ amount: -9000 })],
      { maxDateDiffDays: 3, maxAmountDiff: 100 },
    )

    expect(candidates).toEqual([])
  })

  it('is_settled=falseの既存明細を確定版候補として優先的に先頭へ並べる', () => {
    const target = record()
    const candidates = findApproximateDuplicateCandidates(
      target,
      [
        existing({ journalEntryId: 1, isSettled: true }),
        existing({ journalEntryId: 2, isSettled: false }),
        existing({ journalEntryId: 3, isSettled: null }),
      ],
      { maxDateDiffDays: 3, maxAmountDiff: 100 },
    )

    expect(candidates[0].journalEntryId).toBe(2)
  })

  it('候補が無ければ空配列を返す', () => {
    const target = record({ entryDate: '2026-01-01', amount: 1 })
    const candidates = findApproximateDuplicateCandidates(target, [], {
      maxDateDiffDays: 3,
      maxAmountDiff: 100,
    })

    expect(candidates).toEqual([])
  })
})
