import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { AccountAmount } from '../financial-statement/AccountAmount'
import { summarizeAccountsByCategory } from '../financial-statement/summarizeAccountsByCategory'

export interface ProjectAccountBalances {
  assets: AccountAmount[]
  liabilities: AccountAmount[]
  equity: AccountAmount[]
  revenues: AccountAmount[]
  expenses: AccountAmount[]
}

/**
 * プロジェクト別のPL/BS科目残高内訳(docs/domain/projects.md 1.4節)。
 * isSettlementBalanceZeroと同じ「entriesからproject_id一致のjournal_linesを絞り込み→
 * 区分ごとにsummarizeAccountsByCategoryを適用」という組み立てで、資産・負債・純資産・
 * 収益・費用の全区分について科目別の内訳を返す。project_idは全区分に設定可能なため
 * (1.2節)、既存のaggregateByProject(全区分を合算した単一の数値を返す関数)とは異なり、
 * 区分別・科目別の内訳をそのまま表示したい場合に使う。期間で絞らず全期間が既定(1.4節)。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function summarizeProjectAccountBalances(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  projectId: number,
): ProjectAccountBalances {
  const projectLines = entries.flatMap((entry) => entry.lines).filter((line) => line.projectId === projectId)

  return {
    assets: summarizeAccountsByCategory(projectLines, accounts, 'asset'),
    liabilities: summarizeAccountsByCategory(projectLines, accounts, 'liability'),
    equity: summarizeAccountsByCategory(projectLines, accounts, 'equity'),
    revenues: summarizeAccountsByCategory(projectLines, accounts, 'revenue'),
    expenses: summarizeAccountsByCategory(projectLines, accounts, 'expense'),
  }
}
