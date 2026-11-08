import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { checkExpenseSplittability, findDebitExpenseLines } from './checkExpenseSplittability'

export interface SplittableEntry {
  entry: JournalEntry
  /** 割勘の付け替え対象になる、借方の費用の行 */
  expenseLines: JournalLine[]
  /** 割勘する金額(費用の行の合計) */
  amount: number
}

/**
 * 割勘タブの候補になる仕訳を返す(計画Issue #153)。checkExpenseSplittabilityで割勘できる仕訳
 * (割勘で作られた仕訳・割勘済みの仕訳・借方に費用の行がない仕訳を除く)だけを残し、割勘する金額を
 * 借方の費用の行の合計として添える。絞り込み(JournalEntryFilter)は呼び出し側で重ねる。
 * relatedEntryIdsByEntryIdは関連仕訳グループから組み立てた「仕訳id → 繋がる仕訳idの集合」。
 * DBアクセスなしの純粋関数。
 */
export function listSplittableEntries(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  relatedEntryIdsByEntryId: ReadonlyMap<number, ReadonlySet<number>>,
): SplittableEntry[] {
  const entriesById = new Map(entries.map((e) => [e.id, e]))
  const result: SplittableEntry[] = []
  for (const entry of entries) {
    const related = [...(relatedEntryIdsByEntryId.get(entry.id) ?? [])]
      .map((id) => entriesById.get(id))
      .filter((r): r is JournalEntry => r !== undefined)
    if (!checkExpenseSplittability(entry, accounts, related).splittable) continue
    const expenseLines = findDebitExpenseLines(entry, accounts)
    result.push({ entry, expenseLines, amount: expenseLines.reduce((sum, l) => sum + l.amount, 0) })
  }
  return result
}
