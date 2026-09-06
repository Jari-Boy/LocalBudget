import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'

/**
 * 割勘対象の元仕訳から、付け替え対象の費用科目の行を特定する(docs/domain/
 * expense-splitting.md 1.3・1.4節)。費用科目の行がちょうど1件の場合のみその行を返す。
 * 0件(給与/普通預金のような収益・資産のみの仕訳)は割勘の対象になり得ないため、
 * 2件以上(どの行を付け替え対象にすべきか一意に定まらない)は無警告での部分的な
 * 割勘を避けるため、いずれもundefinedを返す(計画Issue #40、人間レビューでの指摘対応)。
 * 費用科目以外の行(収益・資産等)が同時に存在すること自体は、費用科目の行がちょうど
 * 1件であれば問題なく扱える。
 */
export function findExpenseLine(entry: JournalEntry, accounts: readonly Account[]): JournalLine | undefined {
  const expenseLines = entry.lines.filter(
    (line) => accounts.find((account) => account.id === line.accountId)?.category === 'expense',
  )
  return expenseLines.length === 1 ? expenseLines[0] : undefined
}
