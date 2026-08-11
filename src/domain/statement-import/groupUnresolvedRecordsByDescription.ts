import { normalizeDescriptionForMatching } from './estimateCounterparty'

export interface UnresolvedRecordDescription {
  index: number
  description: string
}

export interface UnresolvedRecordGroup {
  normalizedDescription: string
  recordIndices: number[]
}

/**
 * 取引先が特定できないレコードを正規化後の摘要文字列でグルーピングする
 * (docs/domain/statement-import.md 1.5手順6「摘要のグルーピングによる一括割当て」)。
 * 1件しかマッチしないグループは一括割当ての対象にならないため除外し、2件以上の
 * グループのみ返す。呼び出し側(レビュー画面)は取引先が未特定(counterpartyId === null)の
 * レコードだけを事前にフィルタして渡す。
 */
export function groupUnresolvedRecordsByDescription(
  unresolvedRecords: readonly UnresolvedRecordDescription[],
): UnresolvedRecordGroup[] {
  const indicesByNormalizedDescription = new Map<string, number[]>()

  for (const { index, description } of unresolvedRecords) {
    const normalized = normalizeDescriptionForMatching(description)
    const indices = indicesByNormalizedDescription.get(normalized)
    if (indices === undefined) {
      indicesByNormalizedDescription.set(normalized, [index])
    } else {
      indices.push(index)
    }
  }

  return [...indicesByNormalizedDescription.entries()]
    .filter(([, recordIndices]) => recordIndices.length >= 2)
    .map(([normalizedDescription, recordIndices]) => ({ normalizedDescription, recordIndices }))
}
