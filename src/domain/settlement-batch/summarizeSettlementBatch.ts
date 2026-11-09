import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'

/** 精算の方向。立替金(資産)を減らす'advance'と、未払金(負債)を減らす'payable' */
export type SettlementDirection = 'advance' | 'payable'

export interface SettlementDirectionBreakdown {
  /** 明細行の世帯メンバー。世帯外の相手(取引先)のバッチの行などメンバーが無い行はnull */
  householdMemberId: number | null
  balance: number
}

export interface SettlementDirectionSummary {
  direction: SettlementDirection
  accountId: number
  /** そのバッチに、この科目のタグ付き明細が1行以上あるか */
  hasLines: boolean
  /** 科目の増加側を正とした残高。もう一方の科目とは合算も相殺もしない */
  balance: number
  breakdown: SettlementDirectionBreakdown[]
}

export interface SettlementBatchSummary {
  batch: SettlementBatch
  /** システム管理の立替金科目が無ければnull */
  advance: SettlementDirectionSummary | null
  /** システム管理の未払金科目が無ければnull */
  payable: SettlementDirectionSummary | null
  /** 立替金・未払金のどちらかにタグ付き明細が1行以上あるか */
  hasLines: boolean
  /**
   * 明細が1行以上あり、方向ごとの残高が0。世帯内のバッチは(科目, 世帯メンバー)の組ごとに、
   * 世帯外の相手のバッチは、精算の行が世帯メンバーを持てないため方向ごとの合計で判定する
   */
  isSettled: boolean
}

function summarizeDirection(
  direction: SettlementDirection,
  account: Account | undefined,
  batchId: number,
  lines: readonly JournalLine[],
): SettlementDirectionSummary | null {
  if (account === undefined) return null
  const increasingSide = direction === 'advance' ? 'debit' : 'credit'
  const accountLines = lines.filter((l) => l.settlementBatchId === batchId && l.accountId === account.id)

  const byMember = new Map<number | null, number>()
  for (const l of accountLines) {
    const signed = l.side === increasingSide ? l.amount : -l.amount
    byMember.set(l.householdMemberId, (byMember.get(l.householdMemberId) ?? 0) + signed)
  }
  const breakdown = Array.from(byMember, ([householdMemberId, balance]) => ({ householdMemberId, balance }))

  return {
    direction,
    accountId: account.id,
    hasLines: accountLines.length > 0,
    balance: breakdown.reduce((total, item) => total + item.balance, 0),
    breakdown,
  }
}

function isSettled(batch: SettlementBatch, directions: readonly (SettlementDirectionSummary | null)[]): boolean {
  const withLines = directions.filter((d): d is SettlementDirectionSummary => d !== null && d.hasLines)
  if (withLines.length === 0) return false
  return withLines.every((d) =>
    batch.counterpartyId === null ? d.breakdown.every((b) => b.balance === 0) : d.balance === 0,
  )
}

/**
 * 精算画面の精算バッチ一覧・方向カードに出す集計(docs/domain/settlement.md 1.9、計画Issue #153)。
 * 同じバッチの立替金(資産)と未払金(負債)の残高を別々に求め、合算も相殺もしない。
 * 精算済みは「バッチの残高が0かどうか」だけで判定する(明細のある方向がすべて0。判定の単位は
 * isSettledを参照)ため、
 * 仕訳を削除して残高が0でなくなれば未精算に戻る。DB非依存の純粋関数。
 */
export function summarizeSettlementBatch(
  batch: SettlementBatch,
  lines: readonly JournalLine[],
  accounts: readonly Account[],
): SettlementBatchSummary {
  const advanceAccount = accounts.find((a) => a.category === 'asset' && a.isSystemManaged)
  const payableAccount = accounts.find((a) => a.category === 'liability' && a.isSystemManaged)
  const advance = summarizeDirection('advance', advanceAccount, batch.id, lines)
  const payable = summarizeDirection('payable', payableAccount, batch.id, lines)

  return {
    batch,
    advance,
    payable,
    hasLines: (advance?.hasLines ?? false) || (payable?.hasLines ?? false),
    isSettled: isSettled(batch, [advance, payable]),
  }
}
