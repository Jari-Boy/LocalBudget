import type { Account } from '../account/Account'
import type { JournalEntry } from './JournalEntry'
import type { JournalEntryFilter, JournalEntryFilterContext } from './JournalEntryFilter'
import { filterJournalEntries } from './filterJournalEntries'

/**
 * 絞り込み結果の固定(計画Issue #303)。絞り込み条件を変えた時点で、条件に合う仕訳のIDを集合にして返す。
 * 画面はこれを保持し、編集で仕訳が条件から外れても、条件を変えるまで一覧から消さないために使う。
 * 画面から独立した純粋関数。
 */
export function pinFilteredEntryIds(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  filter: JournalEntryFilter,
  context: JournalEntryFilterContext = {},
): ReadonlySet<number> {
  return new Set(filterJournalEntries(entries, accounts, filter, context).map((entry) => entry.id))
}

/**
 * 現在の条件に合う仕訳と、固定した仕訳(`pinnedIds`)の和集合を、`entries` の並びのまま返す。
 * 固定した仕訳が削除されて `entries` に無ければ含まれない。固定のあとに作られた仕訳は、現在の条件に合うときだけ加わる。
 */
export function filterJournalEntriesWithPinned(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  filter: JournalEntryFilter,
  context: JournalEntryFilterContext,
  pinnedIds: ReadonlySet<number>,
): JournalEntry[] {
  const matched = filterJournalEntries(entries, accounts, filter, context)
  if (pinnedIds.size === 0) return matched
  const matchedIds = new Set(matched.map((entry) => entry.id))
  return entries.filter((entry) => matchedIds.has(entry.id) || pinnedIds.has(entry.id))
}
