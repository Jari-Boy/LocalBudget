import type { AccountCategory } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'

/** 残高集計の対象を一意に特定するタグの組(docs/domain/settlement.md、計画Issue #133) */
export interface SettlementBatchBalanceTarget {
  settlementBatchId: number
  accountId: number
  householdMemberId: number | null
  counterpartyId: number | null
}

/**
 * 精算バッチの未精算残高の集計(docs/domain/settlement.md、計画Issue #133)。
 * (settlement_batch_id, account_id, household_member_id または counterparty_id)に一致する
 * 全ての明細行だけを対象に、科目の区分(asset/liability)に応じた増加側を正としてamountを
 * 合算する。journal_entry_linksのような明示的なリンクを使わず、タグの一致だけで未精算残高を
 * 求める「補助元帳」方式(docs/domain/settlement.md 1.6参照)。資産型(立替金)・負債型(未払金)を
 * 特別扱いせず同一ロジックで扱う。過剰消込(マイナス残高)もDB制約としては禁止しないため、
 * そのまま返す。DBアクセスなしの純粋関数。
 */
export function calculateSettlementBatchBalance(
  lines: readonly JournalLine[],
  accountCategory: Extract<AccountCategory, 'asset' | 'liability'>,
  target: SettlementBatchBalanceTarget,
): number {
  const increasingSide = accountCategory === 'asset' ? 'debit' : 'credit'

  return lines
    .filter(
      (line) =>
        line.settlementBatchId === target.settlementBatchId &&
        line.accountId === target.accountId &&
        line.householdMemberId === target.householdMemberId &&
        line.counterpartyId === target.counterpartyId,
    )
    .reduce((total, line) => total + (line.side === increasingSide ? line.amount : -line.amount), 0)
}
