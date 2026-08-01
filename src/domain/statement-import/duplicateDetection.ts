import type { ImportedRecord } from './ImportedRecord'

export interface PartitionResult {
  /** 既存のexternal_transaction_refsと外部取引IDが完全一致したレコードのインデックス */
  duplicateIndices: number[]
  /** 既存に一致しない、新規として扱うレコードのインデックス */
  newIndices: number[]
}

/**
 * 外部取引IDの完全一致判定(docs/domain/statement-import.md 1.6 手順2-3)。
 * 実際にexternal_transaction_refsを検索する処理(A6のRepository、本Issueのスコープ外)の結果を
 * existingExternalIdsとして受け取り、どのレコードが取込済みの可能性があるかを判定する。
 */
export function partitionByExternalIdDuplicate(
  externalIds: readonly string[],
  existingExternalIds: ReadonlySet<string>,
): PartitionResult {
  const duplicateIndices: number[] = []
  const newIndices: number[] = []

  externalIds.forEach((externalId, index) => {
    if (existingExternalIds.has(externalId)) {
      duplicateIndices.push(index)
    } else {
      newIndices.push(index)
    }
  })

  return { duplicateIndices, newIndices }
}

export interface ExistingTransactionSummary {
  journalEntryId: number
  entryDate: string
  amount: number
  isSettled: boolean | null
}

export interface ApproximateDuplicateSearchOptions {
  /** この日数以内の既存明細のみ候補にする */
  maxDateDiffDays: number
  /** この金額差以内の既存明細のみ候補にする */
  maxAmountDiff: number
}

/**
 * 確定版候補のサジェスト(クレジットカードの速報/確定対策、docs/domain/statement-import.md 1.6)。
 * external_idが完全一致しなくても、日付・金額が近い既存明細を候補として提示する。
 * is_settled = falseの既存明細は確定版に置き換わる可能性が高いため先頭に並べる(1.6)。
 * 近似判定の閾値(日数・金額差)自体はドメイン設計のスコープ外(レビュー画面側の実装課題)のため、
 * 呼び出し側が明示的に渡す引数として扱い、既定値のハードコードやUI設定は行わない。
 */
export function findApproximateDuplicateCandidates(
  target: ImportedRecord,
  existing: readonly ExistingTransactionSummary[],
  options: ApproximateDuplicateSearchOptions,
): ExistingTransactionSummary[] {
  const targetDate = new Date(`${target.entryDate}T00:00:00Z`).getTime()

  const candidates = existing.filter((candidate) => {
    const candidateDate = new Date(`${candidate.entryDate}T00:00:00Z`).getTime()
    const dateDiffDays = Math.abs(targetDate - candidateDate) / (24 * 60 * 60 * 1000)
    const amountDiff = Math.abs(target.amount - candidate.amount)
    return dateDiffDays <= options.maxDateDiffDays && amountDiff <= options.maxAmountDiff
  })

  return [...candidates].sort((a, b) => settledSortWeight(a) - settledSortWeight(b))
}

function settledSortWeight(candidate: ExistingTransactionSummary): number {
  if (candidate.isSettled === false) return 0
  if (candidate.isSettled === null) return 1
  return 2
}
