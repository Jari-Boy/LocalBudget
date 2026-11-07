import type { JournalEntry } from '../journal/JournalEntry'

/**
 * ある仕訳が割勘仕訳(docs/domain/expense-splitting.md 1.3・1.4節)自身であるかどうかを、
 * 作成経路(source_type = 'expense_splitting')で判定する(計画Issue #149)。
 * 以前は科目構成(費用行+is_system_managed=trueの立替金行)から判定していたが、手入力でも立替金を
 * 選べるようになった(計画Issue #145)ため、手入力の仕訳を割勘と誤判定する恐れがあった。
 * 精算仕訳(isExpenseSplitSettlementEntry)は分類を増やさず、科目構成で判定する従来の方式のまま。
 * DBアクセスなしの純粋関数。
 */
export function isExpenseSplitEntry(entry: JournalEntry): boolean {
  return entry.sourceType === 'expense_splitting'
}
