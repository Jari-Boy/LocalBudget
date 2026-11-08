import type { SettlementBatch } from './SettlementBatch'
import type { SettlementTarget } from './SettlementTarget'
import type { SettlementBatchSummary, SettlementDirection } from './summarizeSettlementBatch'

export interface ResolvedSettlementTarget {
  /** 対象者。世帯メンバーを特定できない世帯内のバッチ(明細なし)はnull */
  target: SettlementTarget | null
  /** 精算で比べる残高。選んだ方向の、対象者に対する残高 */
  balance: number
}

/**
 * 精算タブで、選んだバッチ・方向の対象者と、精算の仕訳の合計と比べる残高を決める(計画Issue #153、
 * docs/domain/settlement.md 1.9)。世帯外の相手のバッチは、明細行に取引先を付けられない
 * (counterparties.md 1.2)ため、バッチの取引先を対象者にして、方向全体の残高と比べる。
 * 世帯内のバッチは、その方向で残高が残っている最初の世帯メンバーを対象者にし、そのメンバーの
 * 残高と比べる。その方向に明細が無ければ、もう一方の方向の世帯メンバーを対象者にして残高は0とする
 * (立替金と未払金は合算も相殺もしない)。DB非依存の純粋関数。
 */
export function resolveSettlementTarget(
  batch: SettlementBatch,
  summary: SettlementBatchSummary,
  direction: SettlementDirection,
): ResolvedSettlementTarget {
  const selected = direction === 'advance' ? summary.advance : summary.payable
  const other = direction === 'advance' ? summary.payable : summary.advance

  if (batch.counterpartyId !== null) {
    return {
      target: { kind: 'counterparty', counterpartyId: batch.counterpartyId },
      balance: selected?.balance ?? 0,
    }
  }

  const members = (selected?.breakdown ?? []).filter((b) => b.householdMemberId !== null)
  const open = members.find((b) => b.balance !== 0) ?? members[0]
  if (open !== undefined) {
    return {
      target: { kind: 'householdMember', householdMemberId: open.householdMemberId! },
      balance: open.balance,
    }
  }

  const otherMemberId = (other?.breakdown ?? []).find((b) => b.householdMemberId !== null)?.householdMemberId ?? null
  if (otherMemberId !== null) {
    return { target: { kind: 'householdMember', householdMemberId: otherMemberId }, balance: 0 }
  }
  return { target: null, balance: 0 }
}
