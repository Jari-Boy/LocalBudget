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
  /** 取込側の金額に対する、この割合(0.03なら3%)以内の金額差の既存明細のみ候補にする */
  maxAmountDiffRate: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function dateDiffDays(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / DAY_MS
}

function isApproximate(target: ImportedRecord, candidate: ExistingTransactionSummary, options: ApproximateDuplicateSearchOptions): boolean {
  return (
    dateDiffDays(target.entryDate, candidate.entryDate) <= options.maxDateDiffDays &&
    Math.abs(target.amount - candidate.amount) <= Math.abs(target.amount) * options.maxAmountDiffRate
  )
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
  const candidates = existing.filter((candidate) => isApproximate(target, candidate, options))
  return sortCandidates(target, candidates)
}

/** is_settled=falseを先頭に、続けて金額差・日付差の小さい順に並べる */
function sortCandidates(target: ImportedRecord, candidates: readonly ExistingTransactionSummary[]): ExistingTransactionSummary[] {
  return [...candidates].sort(
    (a, b) =>
      settledSortWeight(a) - settledSortWeight(b) ||
      Math.abs(target.amount - a.amount) - Math.abs(target.amount - b.amount) ||
      dateDiffDays(target.entryDate, a.entryDate) - dateDiffDays(target.entryDate, b.entryDate),
  )
}

/**
 * 取込の全行について確定版候補を求め、1件の既存明細を最も近い1行にだけ紐づける(1対1の割り当て)。
 * 同じ既存明細が複数の行に候補として出ると、似た明細が続くCSVで警告があふれ、複数の行から同じ仕訳を
 * 置き換えようとして二重に削除する恐れがあるため。近さは金額差・日付差・行の並びの順で決める。
 * 候補にしない行(完全一致の重複など)はnullで渡し、空の候補を返す。戻りは入力の行と同じ並び。
 */
export function assignApproximateDuplicateCandidates(
  targets: readonly (ImportedRecord | null)[],
  existing: readonly ExistingTransactionSummary[],
  options: ApproximateDuplicateSearchOptions,
): ExistingTransactionSummary[][] {
  const pairs: { targetIndex: number; candidate: ExistingTransactionSummary; amountDiff: number; dateDiff: number }[] = []
  targets.forEach((target, targetIndex) => {
    if (target === null) return
    for (const candidate of existing) {
      if (!isApproximate(target, candidate, options)) continue
      pairs.push({
        targetIndex,
        candidate,
        amountDiff: Math.abs(target.amount - candidate.amount),
        dateDiff: dateDiffDays(target.entryDate, candidate.entryDate),
      })
    }
  })
  pairs.sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff || a.targetIndex - b.targetIndex)

  const assigned = new Set<number>()
  const perTarget: ExistingTransactionSummary[][] = targets.map(() => [])
  for (const pair of pairs) {
    if (assigned.has(pair.candidate.journalEntryId)) continue
    assigned.add(pair.candidate.journalEntryId)
    perTarget[pair.targetIndex].push(pair.candidate)
  }
  return perTarget.map((candidates, index) => (targets[index] === null ? [] : sortCandidates(targets[index]!, candidates)))
}

function settledSortWeight(candidate: ExistingTransactionSummary): number {
  if (candidate.isSettled === false) return 0
  if (candidate.isSettled === null) return 1
  return 2
}
