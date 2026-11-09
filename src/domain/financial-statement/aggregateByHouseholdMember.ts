import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Period } from './Period'
import { sumBalanceAcrossCategories } from './sumBalanceAcrossCategories'

/**
 * 世帯メンバー別集計(docs/domain/household-members.md 1.4節)。
 * 「メンバー別合計 = Σ(amount WHERE side=増加側) - Σ(amount WHERE side=減少側)、
 * 対象household_memberの明細行、期間で絞らず全期間が既定」を実装する。
 * 世帯メンバーは全区分(資産・負債・純資産・収益・費用)に適用可能なため、
 * counterpartyと異なり区分をまたぐ合算が常に起こりうる。
 * 明細行は常に実際の世帯メンバーを持つため(1.2節、計画Issue #169)、明細行のhouseholdMemberIdで
 * そのまま絞り込む(科目の既定値や起票者へのフォールバックはしない)。区分をまたぐ合算は
 * sumBalanceAcrossCategoriesに委譲し、軸(取引先・メンバー等)非依存の集計エンジンを再利用する。
 * periodを省略した場合は全期間を対象とする。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function aggregateByHouseholdMember(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  householdMemberId: number,
  period?: Period,
): number {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const lines = entries
    .filter((entry) => !period || (entry.entryDate >= period.from && entry.entryDate <= period.to))
    .flatMap((entry) =>
      entry.lines.filter((line) => line.householdMemberId === householdMemberId),
    )

  return sumBalanceAcrossCategories(lines, accountsById)
}
