import type { AccountCategory } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import type { SettlementTarget } from './SettlementTarget'

export interface UnsettledSettlementBatchForTarget {
  batch: SettlementBatch
  balance: number
  /** このバッチ・科目にタグ付けされている仕訳のid一覧(表示用のサマリ組み立てに使う) */
  taggedEntryIds: number[]
}

/**
 * 精算画面(計画Issue #139)の「未精算の明細行(バッチ単位の残高)」一覧を組み立てる純粋関数。
 * 対象者が世帯メンバーの場合、counterparty_idがnullのバッチ(世帯メンバー間のバッチ、
 * docs/domain/settlement.md 2.1)に限定し、household_member_idが対象者と厳密に一致する行だけを
 * 合算する。対象者が取引先の場合、journal_lines.counterparty_idは資産・負債の行に設定できない
 * (docs/domain/counterparties.md 1.2)ため、settlement_batches.counterparty_idが対象者と一致する
 * バッチに限定し、household_member_idを問わずそのバッチ・科目の全行を合算する(誰が立て替えたか
 * にかかわらず、対象の取引先に対する残高は1つに集約する)。残高(calculateSettlementBatchBalanceと
 * 同じ、科目区分に応じた増加側を正とする合算)が0より大きいバッチだけを返す。DBアクセスなしの
 * 純粋関数。
 */
export function findUnsettledSettlementBatchesForTarget(
  lines: readonly JournalLine[],
  batches: readonly SettlementBatch[],
  accountId: number,
  accountCategory: Extract<AccountCategory, 'asset' | 'liability'>,
  target: SettlementTarget,
): UnsettledSettlementBatchForTarget[] {
  const increasingSide = accountCategory === 'asset' ? 'debit' : 'credit'
  const result: UnsettledSettlementBatchForTarget[] = []

  for (const batch of batches) {
    if (target.kind === 'householdMember') {
      if (batch.counterpartyId !== null) continue
    } else {
      if (batch.counterpartyId !== target.counterpartyId) continue
    }

    const matchingLines = lines.filter((line) => {
      if (line.settlementBatchId !== batch.id || line.accountId !== accountId) return false
      if (target.kind === 'householdMember') return line.householdMemberId === target.householdMemberId
      return true
    })
    if (matchingLines.length === 0) continue

    const balance = matchingLines.reduce(
      (total, line) => total + (line.side === increasingSide ? line.amount : -line.amount),
      0,
    )
    if (balance <= 0) continue

    result.push({
      batch,
      balance,
      taggedEntryIds: Array.from(new Set(matchingLines.map((line) => line.journalEntryId))),
    })
  }

  return result
}
