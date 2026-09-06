import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'

/**
 * 割勘対象候補の絞り込み(docs/domain/expense-splitting.md 1.5節、着手時の見直しで追加合意)。
 * 対象の仕訳がallocatesリンクに1件も登場しない(=まだ割勘されておらず、かつ自分自身が
 * 割勘によって作られた仕訳でもない)ものだけを返す。
 *
 * - to_entry側として登場する仕訳は「まだ割勘されていない」対象そのものであり、既に割勘済み
 *   (例: 26/6分)の仕訳が候補として繰り返し表示されないよう除外する
 * - from_entry側として登場する仕訳は、割勘によって作られた仕訳自身(割勘仕訳)であり、
 *   これを再び割勘対象として選べてしまうと「割勘の割勘」という意味のない状態が作れてしまう
 *   ため候補から除外する(人間レビューでの指摘、計画Issue #40)
 *
 * 割勘対象の仕訳選択UIで、上記いずれにも該当しない仕訳だけを候補として使う。
 * src/domain/settlement/findUnsettledEntries.tsと対称的な設計。
 *
 * findLinkedEntries(journal/)はfrom_entry側の仕訳を実体解決するためentriesにその仕訳自体が
 * 含まれている必要があるが、割勘対象候補の絞り込みでは候補一覧(entries)に割勘仕訳側が
 * 含まれるとは限らない。そのためfindLinkedEntriesは使わず、allocatesリンクの有無だけを
 * linksByEntryIdから直接判定する(calculateSettlementBalanceと同じ絞り込みパターン)。
 */
export function findUnallocatedEntries(
  entries: readonly JournalEntry[],
  linksByEntryId: ReadonlyMap<number, readonly JournalEntryLink[]>,
): JournalEntry[] {
  return entries.filter((entry) => {
    const links = linksByEntryId.get(entry.id) ?? []
    return !links.some(
      (link) => link.linkType === 'allocates' && (link.toEntryId === entry.id || link.fromEntryId === entry.id),
    )
  })
}
