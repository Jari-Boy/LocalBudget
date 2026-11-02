import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'
import { isExpenseSplitSettlementEntry } from './isExpenseSplitSettlementEntry'

export interface ExpenseSplittingTrail {
  splitEntry: JournalEntry
  settlementEntries: JournalEntry[]
}

/**
 * 元仕訳→割勘仕訳→精算仕訳のトラバーサル(docs/domain/expense-splitting.md 1.5節)。
 * journal_entry_links(計画Issue #132)のallocates/settlesリンクによる辿り方は計画Issue #138で
 * 廃止され、関連仕訳グループ(表示専用の多対多グルーピング)+科目構成による分類
 * (isExpenseSplitEntry/isExpenseSplitSettlementEntry)に置き換わった。originalEntryの
 * 関連仕訳(relatedEntryIdsByEntryId、buildRelatedEntryIdsByEntryId参照)のうち割勘仕訳と
 * 判定できるものをsplitEntriesとし、各splitEntryの関連仕訳のうち精算仕訳と判定できるものを
 * settlementEntriesとする(いずれも1件の割勘・精算が複数の元仕訳/割勘仕訳をまとめて対象にする
 * ケースを多対多のグループ所属で表現する)。
 *
 * originalEntry自身が割勘仕訳・精算仕訳であった場合は空配列を返す。listExpenseSplittingHistory
 * がentries全件を無差別にoriginalEntry候補として渡すため、割勘仕訳・精算仕訳自身が候補として
 * 渡された場合に、グループで繋がる別の割勘仕訳を誤ってsplitEntriesとして拾ってしまうことを
 * 防ぐガード(originalEntryは「割勘対象になり得る元の支出仕訳」側である前提)。
 * DBアクセスなしの純粋関数。
 */
export function traceExpenseSplittingHistory(
  originalEntry: JournalEntry,
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  relatedEntryIdsByEntryId: ReadonlyMap<number, ReadonlySet<number>>,
): ExpenseSplittingTrail[] {
  if (isExpenseSplitEntry(originalEntry, accounts) || isExpenseSplitSettlementEntry(originalEntry, accounts)) {
    return []
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))

  const resolveRelated = (entryId: number): JournalEntry[] =>
    [...(relatedEntryIdsByEntryId.get(entryId) ?? [])]
      .map((id) => entriesById.get(id))
      .filter((entry): entry is JournalEntry => entry !== undefined)

  const splitEntries = resolveRelated(originalEntry.id).filter((entry) => isExpenseSplitEntry(entry, accounts))

  return splitEntries.map((splitEntry) => ({
    splitEntry,
    settlementEntries: resolveRelated(splitEntry.id).filter((entry) => isExpenseSplitSettlementEntry(entry, accounts)),
  }))
}
