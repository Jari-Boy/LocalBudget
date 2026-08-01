import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Period } from './Period'
import { sumBalanceAcrossCategories } from './sumBalanceAcrossCategories'

/**
 * 取引先別集計(docs/domain/counterparties.md 1.7節)。
 * 「取引先別合計 = Σ(amount WHERE side=増加側) - Σ(amount WHERE side=減少側)、
 * counterparty_id = 対象取引先、期間で絞らず全期間が既定」を実装する。
 * counterparty_idはrevenue/expenseの明細にのみ設定可能(docs/schema/journal.sql)だが、
 * 区分をまたぐ合算はsumBalanceAcrossCategoriesに委譲し、軸(取引先)非依存の
 * 集計エンジンを再利用する。periodを省略した場合は全期間を対象とする。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function aggregateByCounterparty(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  counterpartyId: number,
  period?: Period,
): number {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const lines = entries
    .filter((entry) => !period || (entry.entryDate >= period.from && entry.entryDate <= period.to))
    .flatMap((entry) => entry.lines)
    .filter((line) => line.counterpartyId === counterpartyId)

  return sumBalanceAcrossCategories(lines, accountsById)
}
