import type { AccountCategory } from '../account/Account'
import type { JournalEntry, JournalEntrySourceType } from '../journal/JournalEntry'
import type { ExistingTransactionSummary } from './duplicateDetection'

/**
 * 確定版候補にする作成経路(計画Issue #145 Review Attempt 1)。「これは確定版です」を選ぶと候補の
 * 仕訳は削除されるため、ユーザーが自分で起票した手入力と定期仕訳生成に限る。初期残高・残高調整は
 * 残高照合の土台で、削除すると照合が壊れる。割勘は精算の元になる記録で、外部明細取込は突合マスタで
 * 別に扱う(別口座の取込仕訳を含む)ため、いずれも候補にしない。
 */
const CANDIDATE_SOURCE_TYPES: readonly JournalEntrySourceType[] = ['manual', 'recurring_generated']

/**
 * 突合マスタ(external_transaction_refs)を持たない手入力・定期仕訳生成の仕訳(CANDIDATE_SOURCE_TYPES)
 * のうち、対象科目に明細がある仕訳を、確定版候補(docs/domain/statement-import.md 1.6)の探索対象へ
 * 変換する(計画Issue #145)。手入力で先に記帳した取引のCSVを後から取り込むとき、二重計上を
 * 防ぐために候補として提示する。
 *
 * 金額の符号はImportedRecord.amountと同じ(正 = 対象科目の残高が増える方向)。asset区分は
 * 借方、liability区分は貸方が正(financial-statements.md 2.1の残高計算の一般式)。
 * 同じ仕訳に対象科目の明細が複数あれば符号付きで合算し、0になる仕訳は残高が動かないため除く。
 * isSettledは手入力には存在しないためnullとする。
 */
export function collectUnreferencedTransactions(
  entries: readonly JournalEntry[],
  targetAccount: { id: number; category: AccountCategory },
  referencedJournalEntryIds: ReadonlySet<number>,
): ExistingTransactionSummary[] {
  const positiveSide = targetAccount.category === 'liability' ? 'credit' : 'debit'
  const result: ExistingTransactionSummary[] = []

  for (const entry of entries) {
    if (!CANDIDATE_SOURCE_TYPES.includes(entry.sourceType)) continue
    if (referencedJournalEntryIds.has(entry.id)) continue

    const amount = entry.lines
      .filter((line) => line.accountId === targetAccount.id)
      .reduce((total, line) => total + (line.side === positiveSide ? line.amount : -line.amount), 0)
    if (amount === 0) continue

    result.push({ journalEntryId: entry.id, entryDate: entry.entryDate, amount, isSettled: null })
  }

  return result
}
