import type { JournalEntry } from './JournalEntry'
import type { JournalEntryLink, JournalEntryLinkType } from './JournalEntryLink'

/**
 * journal_entry_linksのlink_type非依存の汎用トラバーサル(docs/domain/journal.md 1.8)。
 * 「to_entry_id = toEntry AND link_type = linkType」に一致するリンクのfrom_entry側の仕訳を
 * entriesから解決して返す。settles(元仕訳→消込仕訳)・allocates(元仕訳→割勘仕訳)いずれの
 * link_typeでも同じロジックで辿れる。linksByEntryIdはJournalEntryRepository.listLinksForEntry
 * の結果(from_entry_id/to_entry_id双方向・複数link_typeが混在しうる)をそのまま渡せるよう、
 * 本関数内でtoEntryId一致かつ指定linkTypeのものだけに絞り込む(calculateSettlementBalance等と
 * 同じ絞り込みパターン)。DBアクセスなしの純粋関数。
 */
export function findLinkedEntries(
  toEntry: JournalEntry,
  linkType: JournalEntryLinkType,
  entries: readonly JournalEntry[],
  linksByEntryId: ReadonlyMap<number, readonly JournalEntryLink[]>,
): JournalEntry[] {
  const links = linksByEntryId.get(toEntry.id) ?? []
  const fromEntryIds = new Set(
    links
      .filter((link) => link.linkType === linkType && link.toEntryId === toEntry.id)
      .map((link) => link.fromEntryId),
  )

  return entries.filter((entry) => fromEntryIds.has(entry.id))
}
