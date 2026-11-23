import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'

/** 割勘で作られた仕訳が、元のどの行を割ったかの記録(割勘対象行テーブル、計画Issue #271) */
export interface ExpenseSplitSourceLink {
  splitEntryId: number
  sourceLineId: number
}

/** 行が選べない理由 */
export type SplittableLineBlockReason = 'not_profit_loss_account'

export interface SplittableLine {
  line: JournalLine
  selectable: boolean
  /** 選べない理由。選べる行はnull */
  reason: SplittableLineBlockReason | null
}

export interface SplittableLineEntry {
  entry: JournalEntry
  /** 割勘済みの行を除いた行(元の並びのまま)。1行以上は選べる行を含む */
  lines: SplittableLine[]
}

/** 借方を正・貸方を負にした行の金額。割勘の合計・按分はこの符号付きの金額で行う(貸方の費用・収益の行は相手の負担を減らす向き) */
export function signedLineAmount(line: Pick<JournalLine, 'side' | 'amount'>): number {
  return line.side === 'debit' ? line.amount : -line.amount
}

/**
 * 割勘タブの候補を、仕訳の明細行単位で返す(計画Issue #271)。選べる行は費用・収益の行(借方・貸方とも)で、
 * それ以外の行(資産・負債・純資産の行)は選べない行として残す。割勘済みの行(割勘対象行の記録に載っている行)は
 * 返さない。割勘で作られた仕訳、選べる行が残らない仕訳は返さない。
 * 割勘対象行の記録を持たない従来の割勘仕訳(行単位化前に作ったもの)に関連仕訳グループで繋がる仕訳は、
 * どの行を割ったか分からないため、従来どおり仕訳全体を割勘済みとして返さない。
 * relatedEntryIdsByEntryIdは関連仕訳グループから組み立てた「仕訳id → 繋がる仕訳idの集合」。DBアクセスなしの純粋関数。
 */
export function listSplittableLineEntries(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  relatedEntryIdsByEntryId: ReadonlyMap<number, ReadonlySet<number>>,
  sourceLinks: readonly ExpenseSplitSourceLink[],
): SplittableLineEntry[] {
  const profitLossAccountIds = new Set(
    accounts.filter((a) => a.category === 'expense' || a.category === 'revenue').map((a) => a.id),
  )
  const splitLineIds = new Set(sourceLinks.map((l) => l.sourceLineId))
  const splitEntryIdsWithLinks = new Set(sourceLinks.map((l) => l.splitEntryId))
  const legacySplitEntryIds = new Set(
    entries.filter((e) => isExpenseSplitEntry(e) && !splitEntryIdsWithLinks.has(e.id)).map((e) => e.id),
  )

  const result: SplittableLineEntry[] = []
  for (const entry of entries) {
    if (isExpenseSplitEntry(entry)) continue
    const related = relatedEntryIdsByEntryId.get(entry.id) ?? new Set<number>()
    if ([...related].some((id) => legacySplitEntryIds.has(id))) continue

    const lines: SplittableLine[] = entry.lines
      .filter((line) => !splitLineIds.has(line.id))
      .map((line) => {
        const selectable = profitLossAccountIds.has(line.accountId)
        return { line, selectable, reason: selectable ? null : ('not_profit_loss_account' as const) }
      })
    if (!lines.some((l) => l.selectable)) continue
    result.push({ entry, lines })
  }
  return result
}
