import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Period } from './Period'
import { sumBalanceAcrossCategories } from './sumBalanceAcrossCategories'

/**
 * プロジェクト別集計(docs/domain/projects.md 1.4節)。
 * 「プロジェクト別科目残高 = Σ(amount WHERE side=増加側) - Σ(amount WHERE side=減少側)、
 * project_id = 対象プロジェクト、期間で絞らず全期間が既定」を実装する。
 * project_idは全区分(資産・負債・純資産・収益・費用)の明細に設定可能なため、
 * 世帯メンバーと同様に区分をまたぐ合算が起こりうる。
 * 区分をまたぐ合算はsumBalanceAcrossCategoriesに委譲し、軸(取引先・世帯メンバー・
 * プロジェクト等)非依存の集計エンジンを再利用する。periodを省略した場合は全期間を対象とする。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function aggregateByProject(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  projectId: number,
  period?: Period,
): number {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const lines = entries
    .filter((entry) => !period || (entry.entryDate >= period.from && entry.entryDate <= period.to))
    .flatMap((entry) => entry.lines)
    .filter((line) => line.projectId === projectId)

  return sumBalanceAcrossCategories(lines, accountsById)
}
