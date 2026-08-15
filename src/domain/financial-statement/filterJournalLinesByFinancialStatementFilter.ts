import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { FinancialStatementFilter } from './FinancialStatementFilter'
import { resolveEffectiveHouseholdMemberId } from './resolveEffectiveHouseholdMemberId'

const NO_MATCH_SENTINEL = -1

/**
 * 複数軸フィルタ(FinancialStatementFilter)による仕訳明細の絞り込み
 * (docs/domain/financial-statements.md 2.2節、計画Issue #34)。プロジェクト・取引先は
 * 明細のIDと直接比較し、世帯メンバーはresolveEffectiveHouseholdMemberId(household-members.md
 * 1.2節、科目既定値→明細の上書き→起票者の順のフォールバック)で実効メンバーを解決してから
 * 判定する。generateFilteredProfitAndLoss・generateFilteredBalanceSheetから共通利用される、
 * PL/BSどちらにも依存しない絞り込みロジック。DB非依存の純粋関数。
 */
export function filterJournalLinesByFinancialStatementFilter(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  filter: FinancialStatementFilter,
): JournalLine[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  const projectIds = filter.projectIds ? new Set(filter.projectIds) : null
  const householdMemberIds = filter.householdMemberIds ? new Set(filter.householdMemberIds) : null
  const counterpartyIds = filter.counterpartyIds ? new Set(filter.counterpartyIds) : null

  return entries.flatMap((entry) =>
    entry.lines.filter((line) => {
      if (projectIds && !projectIds.has(line.projectId ?? NO_MATCH_SENTINEL)) return false
      if (counterpartyIds && !counterpartyIds.has(line.counterpartyId ?? NO_MATCH_SENTINEL)) return false
      if (householdMemberIds) {
        const effectiveId = resolveEffectiveHouseholdMemberId(line, accountsById, entry.householdMemberId)
        if (!householdMemberIds.has(effectiveId)) return false
      }
      return true
    }),
  )
}
