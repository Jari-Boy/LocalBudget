/**
 * 重複防止フロー(docs/domain/statement-import.md 1.6)のうち、完全一致判定(partitionByExternalIdDuplicate)
 * と近似候補提示(findApproximateDuplicateCandidates)の純粋関数としてのユニットテスト。
 * 実際にexternal_transaction_refsを検索するRepository実装はA6(突合ドメイン)側のスコープであり、
 * ここでは「既存の外部取引ID集合/既存明細一覧」を引数として受け取る形で判定ロジックのみを検証する。
 * 近似判定の閾値(日数・金額差の割合)はドメイン設計のスコープ外(1.6)のため、関数の引数として受け取り、
 * 値そのもののパラメータ化(UI設定等)は行わない。assignApproximateDuplicateCandidatesは、1件の既存明細を
 * 最も近い1行にだけ紐づける(1対1の割り当て)ことを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  assignApproximateDuplicateCandidates,
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
      { maxDateDiffDays: 3, maxAmountDiffRate: 0.03 },
    )

    expect(candidates.map((c) => c.journalEntryId)).toEqual([1])
  })

  it('日付が閾値を超える既存明細は候補に含めない', () => {
    const target = record({ entryDate: '2026-07-30' })
    const candidates = findApproximateDuplicateCandidates(
      target,
      [existing({ entryDate: '2026-07-20' })],
      { maxDateDiffDays: 3, maxAmountDiffRate: 0.03 },
    )

    expect(candidates).toEqual([])
  })

  it('金額差が閾値を超える既存明細は候補に含めない', () => {
    const target = record({ amount: -5000 })
    const candidates = findApproximateDuplicateCandidates(
      target,
      [existing({ amount: -9000 })],
      { maxDateDiffDays: 3, maxAmountDiffRate: 0.03 },
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
      { maxDateDiffDays: 3, maxAmountDiffRate: 0.03 },
    )

    expect(candidates[0].journalEntryId).toBe(2)
  })

  it('候補が無ければ空配列を返す', () => {
    const target = record({ entryDate: '2026-01-01', amount: 1 })
    const candidates = findApproximateDuplicateCandidates(target, [], {
      maxDateDiffDays: 3,
      maxAmountDiffRate: 0.03,
    })

    expect(candidates).toEqual([])
  })
})

describe('findApproximateDuplicateCandidates(金額差は割合で判定する)', () => {
  const options = { maxDateDiffDays: 3, maxAmountDiffRate: 0.03 }
  const target: ImportedRecord = {
    entryDate: '2026-07-20',
    description: 'カード利用',
    amount: -3710,
    balanceAfter: null,
    externalId: null,
    isSettled: null,
  }
  const existing = (overrides: Partial<ExistingTransactionSummary>): ExistingTransactionSummary => ({
    journalEntryId: 1,
    entryDate: '2026-07-20',
    amount: -3710,
    isSettled: null,
    ...overrides,
  })

  it('金額差が取込側の金額の3%以内なら候補にし、超えれば候補にしない(3,710円なら111円まで)', () => {
    const within = findApproximateDuplicateCandidates(target, [existing({ amount: -3600 })], options)
    const over = findApproximateDuplicateCandidates(target, [existing({ amount: -3598 })], options)

    expect(within).toHaveLength(1)
    expect(over).toHaveLength(0)
  })

  it('日付差が3日以内なら候補にし、4日離れていれば候補にしない', () => {
    const within = findApproximateDuplicateCandidates(target, [existing({ entryDate: '2026-07-17' })], options)
    const over = findApproximateDuplicateCandidates(target, [existing({ entryDate: '2026-07-16' })], options)

    expect(within).toHaveLength(1)
    expect(over).toHaveLength(0)
  })
})

describe('assignApproximateDuplicateCandidates(1件の既存明細を最も近い1行にだけ紐づける)', () => {
  const options = { maxDateDiffDays: 3, maxAmountDiffRate: 0.03 }
  const rec = (entryDate: string, amount: number): ImportedRecord => ({
    entryDate,
    description: 'コーヒー',
    amount,
    balanceAfter: null,
    externalId: null,
    isSettled: null,
  })
  const ex = (journalEntryId: number, entryDate: string, amount: number, isSettled: boolean | null = null): ExistingTransactionSummary => ({
    journalEntryId,
    entryDate,
    amount,
    isSettled,
  })
  const ids = (rows: ExistingTransactionSummary[][]) => rows.map((r) => r.map((c) => c.journalEntryId))

  it('既存明細が1件で似た行が3行あるとき、金額・日付が最も近い1行にだけ紐づく', () => {
    const rows = [rec('2026-07-19', -480), rec('2026-07-20', -480), rec('2026-07-22', -480)]

    const result = assignApproximateDuplicateCandidates(rows, [ex(1, '2026-07-20', -480)], options)

    expect(ids(result)).toEqual([[], [1], []])
  })

  it('金額が完全一致する行を、日付が近いだけの行より優先する', () => {
    const rows = [rec('2026-07-20', -490), rec('2026-07-22', -480)]

    const result = assignApproximateDuplicateCandidates(rows, [ex(1, '2026-07-20', -480)], options)

    expect(ids(result)).toEqual([[], [1]])
  })

  it('既存明細が複数あるとき、それぞれが最も近い行に紐づき、同じ既存明細が2行に出ない', () => {
    const rows = [rec('2026-07-20', -480), rec('2026-07-21', -480)]

    const result = assignApproximateDuplicateCandidates(rows, [ex(1, '2026-07-20', -480), ex(2, '2026-07-21', -480)], options)

    expect(ids(result)).toEqual([[1], [2]])
  })

  it('1行に複数の既存明細が紐づくときは、is_settled=falseを先頭に、続けて金額差・日付差の小さい順に並べる', () => {
    const rows = [rec('2026-07-20', -480)]

    const result = assignApproximateDuplicateCandidates(
      rows,
      [ex(1, '2026-07-22', -480), ex(2, '2026-07-20', -485), ex(3, '2026-07-21', -480, false), ex(4, '2026-07-20', -480)],
      options,
    )

    expect(ids(result)).toEqual([[3, 4, 1, 2]])
  })

  it('対象外(null)の行には、既存明細を紐づけない', () => {
    const rows = [null, rec('2026-07-20', -480)]

    const result = assignApproximateDuplicateCandidates(rows, [ex(1, '2026-07-20', -480)], options)

    expect(ids(result)).toEqual([[], [1]])
  })

  it('似た既存明細が無い行は空配列になる', () => {
    const result = assignApproximateDuplicateCandidates([rec('2026-07-20', -480)], [ex(1, '2026-01-01', -9999)], options)

    expect(ids(result)).toEqual([[]])
  })
})
