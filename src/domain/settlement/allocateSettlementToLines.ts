export interface SettlementCandidateLine {
  lineId: number
  /** その行の消込残高(0より大きい) */
  balance: number
}

export interface SettlementAllocation {
  toLineId: number
  amount: number
}

/**
 * 1回の精算額を、複数の未消込の明細行へ先頭から順に割り当てる純粋関数
 * (docs/domain/settlement.md 1.7のN:N、計画Issue #132)。
 * candidatesの並び順がそのまま消込の優先順位になる(呼び出し側で古い順などに並べておく)。
 * 各行には消込残高を上限として割り当て、割り当てが0円になる行は結果に含めない。
 * 精算額が全行の残高の合計を超える場合(過剰消込、settlement.md 1.6で許容)は、超過分を
 * 最後に割り当てた行に上乗せし、精算仕訳の一時勘定行の金額と、そこから出るリンクの金額の
 * 合計が常に一致するようにする。
 */
export function allocateSettlementToLines(
  candidates: readonly SettlementCandidateLine[],
  amount: number,
): SettlementAllocation[] {
  if (candidates.length === 0 || amount <= 0) return []

  const allocations: SettlementAllocation[] = []
  let remaining = amount
  for (const candidate of candidates) {
    if (remaining <= 0) break
    const allocated = Math.min(candidate.balance, remaining)
    if (allocated <= 0) continue
    allocations.push({ toLineId: candidate.lineId, amount: allocated })
    remaining -= allocated
  }

  if (remaining > 0) {
    const last = allocations.at(-1)
    if (last === undefined) {
      allocations.push({ toLineId: candidates[0].lineId, amount: remaining })
    } else {
      last.amount += remaining
    }
  }
  return allocations
}
