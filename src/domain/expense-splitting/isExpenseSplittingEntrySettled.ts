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
 * settlesリンク自体はどの立替金科目を対象にした精算かの情報を持たないため、リンクの
 * from_entry側(精算仕訳の実体)をentriesから解決し、その精算仕訳が実際に使っている
 * 科目で紐づける(buildSettlementJournalEntryInputは対象の一時勘定科目の行を必ず1本だけ
 * 持つ仕訳を組み立てるため、この対応付けが成立する)。calculateSettlementBalanceは
 * 1科目分のリンクのみを渡す前提のため、科目ごとに絞り込んでから渡す。DBアクセスなしの純粋関数。
 */
export function isExpenseSplittingEntrySettled(
  splitEntry: JournalEntry,
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  links: readonly JournalEntryLink[],
): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))

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

  return Array.from(advanceAccountIds).every((accountId) => {
    const linksForAccount = links.filter((link) => {
      if (link.linkType !== 'settles' || link.toEntryId !== splitEntry.id) return false
      const settlementEntry = entriesById.get(link.fromEntryId)
      return settlementEntry?.lines.some((line) => line.accountId === accountId) ?? false
    })
    return calculateSettlementBalance(splitEntry, accountId, linksForAccount) === 0
  })
}
