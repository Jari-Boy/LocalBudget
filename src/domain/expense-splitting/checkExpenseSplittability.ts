import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { ExpenseSplitSourceLink } from './listSplittableLineEntries'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'

/** 割勘できない理由(計画Issue #149)。判定の優先順に並べている */
export type ExpenseSplitBlockReason =
  /** 割勘で作られた仕訳(「割勘の割勘」を防ぐ) */
  | 'is_expense_split_entry'
  /** 割勘済み(割勘対象行の記録がない従来の割勘仕訳に繋がる、または費用・収益の行がすべて割勘済み) */
  | 'already_split'
  /** 費用・収益の行がない(資産・負債だけの仕訳など) */
  | 'no_profit_loss_line'

export type ExpenseSplittability = { splittable: true } | { splittable: false; reason: ExpenseSplitBlockReason }

/**
 * ある仕訳を割勘できるかと、できない場合の理由を返す(計画Issue #149。計画Issue #271で明細行単位の割勘に合わせた)。
 * 割勘の対象になる行は費用・収益の行(借方・貸方とも)。割勘済みの行(割勘対象行の記録sourceLinksに載っている行)を
 * 除いて、選べる行が1つでも残れば割勘できる。複数の条件に当たる場合は、ExpenseSplitBlockReasonの並び順の先頭の理由を返す。
 * relatedEntriesは、関連仕訳グループ(表示専用の多対多グルーピング)でこの仕訳と繋がる仕訳。そのうち、割勘対象行の記録を
 * 持たない従来の割勘仕訳(行単位化前に作ったもの)に繋がる仕訳は、どの行を割ったか分からないため仕訳全体を割勘済みとする。
 * DBアクセスなしの純粋関数。
 */
export function checkExpenseSplittability(
  entry: JournalEntry,
  accounts: readonly Account[],
  relatedEntries: readonly JournalEntry[],
  sourceLinks: readonly ExpenseSplitSourceLink[] = [],
): ExpenseSplittability {
  if (isExpenseSplitEntry(entry)) return { splittable: false, reason: 'is_expense_split_entry' }
  const splitEntryIdsWithLinks = new Set(sourceLinks.map((l) => l.splitEntryId))
  if (relatedEntries.some((r) => isExpenseSplitEntry(r) && !splitEntryIdsWithLinks.has(r.id))) {
    return { splittable: false, reason: 'already_split' }
  }
  const profitLossAccountIds = new Set(
    accounts.filter((a) => a.category === 'expense' || a.category === 'revenue').map((a) => a.id),
  )
  const profitLossLines = entry.lines.filter((line) => profitLossAccountIds.has(line.accountId))
  if (profitLossLines.length === 0) return { splittable: false, reason: 'no_profit_loss_line' }
  const splitLineIds = new Set(sourceLinks.map((l) => l.sourceLineId))
  if (profitLossLines.every((line) => splitLineIds.has(line.id))) return { splittable: false, reason: 'already_split' }
  return { splittable: true }
}
