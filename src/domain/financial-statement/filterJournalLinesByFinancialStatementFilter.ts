import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { FinancialStatementFilter } from './FinancialStatementFilter'

const NO_MATCH_SENTINEL = -1

/**
 * 複数軸フィルタ(FinancialStatementFilter)による仕訳明細の絞り込み
 * (docs/domain/financial-statements.md 2.2節、計画Issue #34)。プロジェクト・取引先は
 * 明細のIDと直接比較し、世帯メンバーも明細行のhouseholdMemberIdと直接比較する(明細行は常に
 * 実際の世帯メンバーを持つ、household-members.md 1.2節、計画Issue #169)。generateFilteredProfitAndLoss・generateFilteredBalanceSheetから共通利用される、
 * PL/BSどちらにも依存しない絞り込みロジック。DB非依存の純粋関数。
 */
export function filterJournalLinesByFinancialStatementFilter(
  entries: readonly JournalEntry[],
  filter: FinancialStatementFilter,
): JournalLine[] {
  const projectIds = filter.projectIds ? new Set(filter.projectIds) : null
  const householdMemberIds = filter.householdMemberIds ? new Set(filter.householdMemberIds) : null
  const counterpartyIds = filter.counterpartyIds ? new Set(filter.counterpartyIds) : null

  return entries.flatMap((entry) =>
    entry.lines.filter((line) => {
      if (projectIds && !projectIds.has(line.projectId ?? NO_MATCH_SENTINEL)) return false
      if (counterpartyIds && !counterpartyIds.has(line.counterpartyId ?? NO_MATCH_SENTINEL)) return false
      if (householdMemberIds && !householdMemberIds.has(line.householdMemberId)) return false
      return true
    }),
  )
}
