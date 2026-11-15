import type { BalanceAnchor } from './planBalanceAnchorAdjustments'

/** external_transaction_refs のうち基準点の導出に使う列 */
export interface StatementAnchorSource {
  id: number
  entryDate: string
  /** 正 = 科目の残高が増える方向 */
  amount: number
  externalBalanceAfter: number | null
  /** 取込時のCSV上の行の順番。既存データはnullでid順で代用する */
  rowOrder: number | null
  /** 取込ごとのまとまり(imported_at)。並び順の判定は取込単位で行う */
  importedAt: string
}

/**
 * 取り込んだ明細から基準点を導く純粋関数(計画Issue #205、docs/domain/reconciliation.md 1.5)。
 * 取込ごとに行順で並べ、balance_after[i] = balance_after[i-1] + amount[i] が成り立てば昇順、
 * そうでなければ降順として時系列に直す。各日は時系列で最後の行の残高を基準点とし、
 * 時系列で最初の行の(残高 − 金額)を前日の基準点(取り込み開始直前の残高)として加える。
 * 同じ日の基準点が重なる場合は、後ろに置いたもの(実際の行の残高)が優先される。
 */
export function resolveStatementAnchors(sources: readonly StatementAnchorSource[]): BalanceAnchor[] {
  const batches = new Map<string, StatementAnchorSource[]>()
  for (const source of sources) {
    if (source.externalBalanceAfter === null) continue
    const batch = batches.get(source.importedAt) ?? []
    batch.push(source)
    batches.set(source.importedAt, batch)
  }

  const startAnchors: BalanceAnchor[] = []
  const rowAnchors: BalanceAnchor[] = []
  for (const batch of batches.values()) {
    const chronological = toChronological(batch)
    const first = chronological[0]
    startAnchors.push({ date: previousDay(first.entryDate), balance: first.externalBalanceAfter! - first.amount })
    for (const source of chronological) {
      // 時系列順に積むので、同じ日は最後の行が残る(呼び出し側で後勝ちに正規化される)
      rowAnchors.push({ date: source.entryDate, balance: source.externalBalanceAfter! })
    }
  }
  return [...startAnchors, ...rowAnchors]
}

function toChronological(batch: readonly StatementAnchorSource[]): StatementAnchorSource[] {
  const ordered = [...batch].sort((a, b) => (a.rowOrder ?? a.id) - (b.rowOrder ?? b.id) || a.id - b.id)
  if (ordered.length < 2) return ordered
  const ascending = ordered.every(
    (source, index) =>
      index === 0 || source.externalBalanceAfter! === ordered[index - 1].externalBalanceAfter! + source.amount,
  )
  if (ascending) return ordered
  const reversed = [...ordered].reverse()
  const descending = reversed.every(
    (source, index) =>
      index === 0 || source.externalBalanceAfter! === reversed[index - 1].externalBalanceAfter! + source.amount,
  )
  // どちらでも整合しない(欠落など)ときは、日付が昇順になるほうを採る
  if (descending) return reversed
  return ordered[0].entryDate <= ordered[ordered.length - 1].entryDate ? ordered : reversed
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
