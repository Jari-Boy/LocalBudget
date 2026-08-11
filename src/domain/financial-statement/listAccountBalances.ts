import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { calculateAccountBalance } from './calculateAccountBalance'

export interface AccountBalance {
  accountId: number
  accountName: string
  amount: number
  householdMemberId: number | null
}

/**
 * 登録済み科目一覧+残高(計画Issue #70、科目一覧確認画面)。summarizeAccountsByCategoryと異なり
 * 区分の絞り込み・残高0科目の除外は行わず、渡されたaccounts全件について
 * calculateAccountBalanceの残高計算式(docs/domain/financial-statements.md 2.1節)を適用する。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function listAccountBalances(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
): AccountBalance[] {
  const lines = entries.flatMap((entry) => entry.lines)
  return accounts.map((account) => {
    const accountLines = lines.filter((line) => line.accountId === account.id)
    return {
      accountId: account.id,
      accountName: account.name,
      amount: calculateAccountBalance(account.category, accountLines),
      householdMemberId: account.householdMemberId,
    }
  })
}
