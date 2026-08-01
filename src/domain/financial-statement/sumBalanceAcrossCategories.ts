import type { Account, AccountCategory } from '../account/Account'
import type { JournalLineSide } from '../journal/JournalEntry'
import { calculateAccountBalance } from './calculateAccountBalance'

export interface CategorizableLine {
  accountId: number
  side: JournalLineSide
  amount: number
}

/**
 * 区分をまたいだ軸集計エンジン(docs/domain/counterparties.md 1.7節・
 * docs/domain/household-members.md 1.4節の「区分に応じて符号反転」)。
 * 取引先別・世帯メンバー別集計のように、絞り込んだ明細群が複数区分(資産・負債・純資産・
 * 収益・費用)にまたがりうる場合に、明細を科目の区分ごとにグルーピングしてから
 * calculateAccountBalanceの残高計算式を適用し、その結果を合算する。
 * 特定の軸(取引先・世帯メンバー等)に依存しない汎用ロジックとし、各軸の絞り込みは
 * 呼び出し側(aggregateByCounterparty・aggregateByHouseholdMember等)が担う。
 * DB非依存の純粋関数。
 */
export function sumBalanceAcrossCategories(
  lines: readonly CategorizableLine[],
  accountsById: ReadonlyMap<number, Account>,
): number {
  const linesByCategory = new Map<AccountCategory, CategorizableLine[]>()

  for (const line of lines) {
    const category = accountsById.get(line.accountId)?.category
    if (category === undefined) continue

    const group = linesByCategory.get(category)
    if (group) {
      group.push(line)
    } else {
      linesByCategory.set(category, [line])
    }
  }

  let total = 0
  for (const [category, groupLines] of linesByCategory) {
    total += calculateAccountBalance(category, groupLines)
  }

  return total
}
