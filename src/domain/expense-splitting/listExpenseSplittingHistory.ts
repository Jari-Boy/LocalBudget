import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { traceExpenseSplittingHistory } from './traceExpenseSplittingHistory'

export interface ExpenseSplittingHistoryEntry {
  splitEntry: JournalEntry
  originalEntries: JournalEntry[]
  settlementEntries: JournalEntry[]
}

/**
 * 全仕訳を横断した割勘履歴一覧の構築(docs/domain/expense-splitting.md 1.5節)。
 * 個々の元仕訳を起点にするtraceExpenseSplittingHistory(計画Issue #138で関連仕訳グループ+
 * 科目構成による分類に書き換え済み)をentries全件に対して実行し、結果をsplitEntry
 * (割勘仕訳)のidでグルーピングし直す合成関数。1件の割勘仕訳が複数の元仕訳を対象にする
 * 場合、同じ割勘仕訳がtraceの実行回数分重複して見つかるため、originalEntriesとして1件の
 * 履歴エントリに統合する。
 *
 * originalEntriesは取引日(entryDate)の昇順に並べ替える。呼び出し元(entries引数)は
 * 通常RepositoryのfindAll()の結果であり、その並び順はid採番順(挿入順)であって
 * 取引日順とは限らない。DBアクセスなしの純粋関数。
 */
export function listExpenseSplittingHistory(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  relatedEntryIdsByEntryId: ReadonlyMap<number, ReadonlySet<number>>,
): ExpenseSplittingHistoryEntry[] {
  const bySplitEntryId = new Map<number, ExpenseSplittingHistoryEntry>()

  for (const candidate of entries) {
    const trails = traceExpenseSplittingHistory(candidate, entries, accounts, relatedEntryIdsByEntryId)
    for (const trail of trails) {
      const existing = bySplitEntryId.get(trail.splitEntry.id)
      if (existing === undefined) {
        bySplitEntryId.set(trail.splitEntry.id, {
          splitEntry: trail.splitEntry,
          originalEntries: [candidate],
          settlementEntries: trail.settlementEntries,
        })
      } else {
        existing.originalEntries.push(candidate)
      }
    }
  }

  const result = Array.from(bySplitEntryId.values())
  for (const item of result) {
    item.originalEntries.sort((a, b) => a.entryDate.localeCompare(b.entryDate))
  }
  return result
}
