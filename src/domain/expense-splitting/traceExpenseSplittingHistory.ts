import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { findLinkedEntries } from '../journal/findLinkedEntries'

export interface ExpenseSplittingTrail {
  splitEntry: JournalEntry
  settlementEntries: JournalEntry[]
}

/**
 * 元仕訳→割勘仕訳→精算仕訳のトラバーサル(docs/domain/expense-splitting.md 1.5節)。
 * journal/findLinkedEntries(link_type非依存の汎用プリミティブ)を、まずallocatesで
 * 元仕訳から割勘仕訳を辿り、続けて各割勘仕訳をsettlesで辿って精算仕訳を求める、
 * という2段階で合成した薄い関数。1回の割勘バッチが複数の元仕訳をまとめて対象にすることも
 * あるため(allocatesの1対多)、割勘仕訳は複数件になりうる。DBアクセスなしの純粋関数。
 */
export function traceExpenseSplittingHistory(
  originalEntry: JournalEntry,
  entries: readonly JournalEntry[],
  linksByEntryId: ReadonlyMap<number, readonly JournalEntryLink[]>,
): ExpenseSplittingTrail[] {
  const splitEntries = findLinkedEntries(originalEntry, 'allocates', entries, linksByEntryId)

  return splitEntries.map((splitEntry) => ({
    splitEntry,
    settlementEntries: findLinkedEntries(splitEntry, 'settles', entries, linksByEntryId),
  }))
}
