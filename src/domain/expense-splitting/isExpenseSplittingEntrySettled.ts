import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { calculateSettlementBalance } from '../settlement/calculateSettlementBalance'

/**
 * 割勘仕訳の精算状況判定(docs/domain/expense-splitting.md 1.3・1.5節)。
 * 割勘仕訳が持つ立替金科目(is_system_managed=trueの資産・負債)の行それぞれについて
 * settlementドメインのcalculateSettlementBalanceを適用し、いずれの残高も0になって
 * 初めて「精算済み」とみなす。世帯メンバー間の割勘は資産側(立替者の債権)・負債側
 * (分担者の債務)が別々のタイミングで精算されうる(1.3節、精算1・精算2)ため、
 * 片方のみの精算を「精算済み」と誤判定しないよう両方を確認する。世帯外の相手との
 * 割勘は資産側の行しか持たないため、その1件のみで判定される。
 *
 * settlesリンクは明細行単位(計画Issue #132)で割勘仕訳の立替金行(to_line)に直接結びつくため、
 * 以前のように精算仕訳(from_entry側)の実体を解決して使っている科目で絞り込む必要はない。
 * calculateSettlementBalanceが行ごとにリンクを集計するので、科目ごとの判定に全リンクを
 * そのまま渡せる。DBアクセスなしの純粋関数。
 */
export function isExpenseSplittingEntrySettled(
  splitEntry: JournalEntry,
  accounts: readonly Account[],
  links: readonly JournalEntryLink[],
): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const advanceAccountIds = new Set(
    splitEntry.lines
      .map((line) => line.accountId)
      .filter((accountId) => {
        const account = accountsById.get(accountId)
        return (
          account?.isSystemManaged === true && (account.category === 'asset' || account.category === 'liability')
        )
      }),
  )

  return Array.from(advanceAccountIds).every(
    (accountId) => calculateSettlementBalance(splitEntry, accountId, links) === 0,
  )
}
