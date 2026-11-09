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
 * docs/domain/settlement.md 1.9)。誰にどれだけ債権債務があるかは「科目×世帯メンバー」で持ち、バッチは
 * イベントをまとめるだけなので、バッチが世帯内でも世帯外の相手(取引先)でも、対象者は世帯メンバーである
 * (すべての行に世帯メンバーが入る前提。制約の実装は別Issue)。その方向で残高が残っている最初の
 * 世帯メンバーを対象者にし、そのメンバーの残高と比べる。その方向に明細が無ければ、もう一方の方向の
 * 世帯メンバーを対象者にして残高は0とする(立替金と未払金は合算も相殺もしない)。DB非依存の純粋関数。
 */
export function resolveSettlementTarget(
  summary: SettlementBatchSummary,
  direction: SettlementDirection,
): ResolvedSettlementTarget {
  const selected = direction === 'advance' ? summary.advance : summary.payable
  const other = direction === 'advance' ? summary.payable : summary.advance

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
