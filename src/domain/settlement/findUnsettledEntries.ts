import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { calculateSettlementBalance } from './calculateSettlementBalance'

/**
 * 未消込エントリの判定(docs/domain/settlement.md 1.6)。
 * 消込残高(calculateSettlementBalance)が0より大きい元仕訳を「未消込」として抽出する。
 * linksByEntryIdは各元仕訳のJournalEntryRepository.listLinksForEntry結果を
 * entryIdをキーとして保持するMap(該当エントリがキーに存在しない場合はリンク0件として扱う)。
 */
export function findUnsettledEntries(
  entries: readonly JournalEntry[],
  settlementAccountId: number,
  linksByEntryId: ReadonlyMap<number, readonly JournalEntryLink[]>,
): JournalEntry[] {
  return entries.filter(
    (entry) =>
      calculateSettlementBalance(entry, settlementAccountId, linksByEntryId.get(entry.id) ?? []) > 0,
  )
}
