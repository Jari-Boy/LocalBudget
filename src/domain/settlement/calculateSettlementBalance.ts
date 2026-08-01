import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'

/**
 * 消込残高の計算(docs/domain/settlement.md 1.6)。
 * 元仕訳(toEntry)の一時勘定科目行(settlementAccountId)の金額から、その仕訳をto_entryとする
 * settlesリンクの金額合計を差し引く。linksにはJournalEntryRepository.listLinksForEntryの返り値
 * (from_entry_id/to_entry_id双方向・allocatesも混在しうる)をそのまま渡せるよう、
 * linkType='settles'かつtoEntryId=toEntry.idのものだけを本関数内で絞り込む。
 */
export function calculateSettlementBalance(
  toEntry: JournalEntry,
  settlementAccountId: number,
  links: readonly JournalEntryLink[],
): number {
  const temporaryLineAmount = toEntry.lines
    .filter((line) => line.accountId === settlementAccountId)
    .reduce((total, line) => total + line.amount, 0)

  const settledAmount = links
    .filter((link) => link.linkType === 'settles' && link.toEntryId === toEntry.id)
    .reduce((total, link) => total + link.amount, 0)

  return temporaryLineAmount - settledAmount
}
