import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'

/** 割勘できない理由(計画Issue #149)。判定の優先順に並べている */
export type ExpenseSplitBlockReason =
  /** 割勘で作られた仕訳(「割勘の割勘」を防ぐ) */
  | 'is_expense_split_entry'
  /** 関連仕訳に割勘で作られた仕訳がある(割勘済み) */
  | 'already_split'
  /** 借方に費用の行がない(収益だけの仕訳、費用が貸方だけの仕訳を含む) */
  | 'no_debit_expense_line'

export type ExpenseSplittability = { splittable: true } | { splittable: false; reason: ExpenseSplitBlockReason }

/**
 * 割勘の付け替え対象になる行(借方の費用科目の行)をすべて返す(docs/domain/expense-splitting.md
 * 1.3・1.4節、計画Issue #149)。以前は費用の行がちょうど1件の仕訳だけを対象にしていたが、
 * 費用の行が複数ある仕訳も、各行を同じ割合で割ることで割勘できるようにした。
 * 貸方の費用行(返金など)は付け替え対象にしない。
 */
export function findDebitExpenseLines(entry: JournalEntry, accounts: readonly Account[]): JournalLine[] {
  const expenseAccountIds = new Set(accounts.filter((account) => account.category === 'expense').map((a) => a.id))
  return entry.lines.filter((line) => line.side === 'debit' && expenseAccountIds.has(line.accountId))
}

/**
 * ある仕訳を割勘できるかと、できない場合の理由を返す(計画Issue #149)。割勘の対象選択画面が
 * これを使う。複数の条件に当たる場合は、ExpenseSplitBlockReasonの並び順の先頭の理由を返す。
 * relatedEntriesは、関連仕訳グループ(表示専用の多対多グルーピング)でこの仕訳と繋がる仕訳。
 * DBアクセスなしの純粋関数。
 */
export function checkExpenseSplittability(
  entry: JournalEntry,
  accounts: readonly Account[],
  relatedEntries: readonly JournalEntry[],
): ExpenseSplittability {
  if (isExpenseSplitEntry(entry)) return { splittable: false, reason: 'is_expense_split_entry' }
  if (relatedEntries.some(isExpenseSplitEntry)) return { splittable: false, reason: 'already_split' }
  if (findDebitExpenseLines(entry, accounts).length === 0) {
    return { splittable: false, reason: 'no_debit_expense_line' }
  }
  return { splittable: true }
}
