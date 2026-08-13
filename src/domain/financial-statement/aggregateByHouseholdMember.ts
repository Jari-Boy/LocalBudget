import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Period } from './Period'
import { resolveEffectiveHouseholdMemberId } from './resolveEffectiveHouseholdMemberId'
import { sumBalanceAcrossCategories } from './sumBalanceAcrossCategories'

/**
 * 世帯メンバー別集計(docs/domain/household-members.md 1.4節)。
 * 「メンバー別合計 = Σ(amount WHERE side=増加側) - Σ(amount WHERE side=減少側)、
 * 実効メンバー = 対象household_member、期間で絞らず全期間が既定」を実装する。
 * 世帯メンバーは全区分(資産・負債・純資産・収益・費用)に適用可能なため、
 * counterpartyと異なり区分をまたぐ合算が常に起こりうる。
 * 実効メンバーの解決(1.2節、科目既定値の強制→明細の上書き→ヘッダーの起票者の順の
 * フォールバックルール)を経由してから絞り込み、区分をまたぐ合算はsumBalanceAcrossCategories
 * に委譲し、軸(取引先・メンバー等)非依存の集計エンジンを再利用する。
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
      entry.lines.filter(
        (line) =>
          resolveEffectiveHouseholdMemberId(line, accountsById, entry.householdMemberId) ===
          householdMemberId,
      ),
    )

  return sumBalanceAcrossCategories(lines, accountsById)
}
