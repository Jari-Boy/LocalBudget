import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'

/**
 * 割勘対象候補の絞り込み(docs/domain/expense-splitting.md 1.5節、着手時の見直しで追加合意)。
 * 対象の仕訳がallocatesリンク(to_entry側)を1件も持たない(=まだ割勘されていない)ものだけを
 * 返す。割勘対象の仕訳選択UIで、既に割勘済み(例: 26/6分)の仕訳が候補として繰り返し
 * 表示されないよう除外するために使う。src/domain/settlement/findUnsettledEntries.tsと
 * 対称的な設計。
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
    return !links.some((link) => link.linkType === 'allocates' && link.toEntryId === entry.id)
  })
}
