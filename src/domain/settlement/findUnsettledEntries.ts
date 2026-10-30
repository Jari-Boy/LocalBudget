import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { calculateLineSettlementBalance, findSettlementTargetLines } from './calculateSettlementBalance'

export interface UnsettledLine {
  entry: JournalEntry
  /** 消込先の一時勘定行 */
  line: JournalLine
  /** その行の消込残高(0より大きい) */
  balance: number
}

/**
 * 未消込の明細行の判定(docs/domain/settlement.md 1.6、計画Issue #132)。
 * 指定した一時勘定科目の明細行のうち、消込残高(calculateLineSettlementBalance)が0より大きいものを
 * 返す。消込仕訳自身の行(settlesリンクのfrom_line)は消込対象にならない(findSettlementTargetLines)。
 * linksByEntryIdは各仕訳のJournalEntryRepository.listLinksForEntry結果をentryIdをキーとして
 * 保持するMap(該当エントリがキーに存在しない場合はリンク0件として扱う)。
 */
export function findUnsettledLines(
  entries: readonly JournalEntry[],
  settlementAccountId: number,
  linksByEntryId: ReadonlyMap<number, readonly JournalEntryLink[]>,
): UnsettledLine[] {
  return entries.flatMap((entry) => {
    const links = linksByEntryId.get(entry.id) ?? []
    return findSettlementTargetLines(entry, settlementAccountId, links)
      .map((line) => ({ entry, line, balance: calculateLineSettlementBalance(line, links) }))
      .filter((unsettled) => unsettled.balance > 0)
  })
}

/**
 * 未消込エントリの判定。未消込の明細行(findUnsettledLines)を1行でも持つ仕訳を返す。
 */
export function findUnsettledEntries(
  entries: readonly JournalEntry[],
  settlementAccountId: number,
  linksByEntryId: ReadonlyMap<number, readonly JournalEntryLink[]>,
): JournalEntry[] {
  const unsettledEntryIds = new Set(
    findUnsettledLines(entries, settlementAccountId, linksByEntryId).map(({ entry }) => entry.id),
  )
  return entries.filter((entry) => unsettledEntryIds.has(entry.id))
}
