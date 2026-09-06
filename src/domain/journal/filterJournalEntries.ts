import type { Account } from '../account/Account'
import { resolveEffectiveHouseholdMemberId } from '../financial-statement/resolveEffectiveHouseholdMemberId'
import type { JournalEntry } from './JournalEntry'
import type { JournalEntryFilter } from './JournalEntryFilter'

/**
 * 仕訳の複数軸絞り込み(計画Issue #40、割勘対象選択画面での再利用を見据えた共通フィルタ)。
 * 期間(dateFrom/dateTo)・科目(accountId)・世帯メンバー(householdMemberId)・
 * プロジェクト(projectId)をAND条件で組み合わせる。科目・世帯メンバー・プロジェクトは
 * 「仕訳内のいずれかの明細行が条件に一致すればその仕訳を含める」(行単位ではなく
 * 仕訳単位でフィルタする)。世帯メンバーの判定は
 * financial-statementドメインのresolveEffectiveHouseholdMemberId(科目既定値→明細の
 * 上書き→起票者の順のフォールバック)を再利用する。DB非依存の純粋関数。
 */
export function filterJournalEntries(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  filter: JournalEntryFilter,
): JournalEntry[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  return entries.filter((entry) => {
    if (filter.dateFrom !== undefined && entry.entryDate < filter.dateFrom) return false
    if (filter.dateTo !== undefined && entry.entryDate > filter.dateTo) return false
    if (filter.accountId !== undefined && !entry.lines.some((line) => line.accountId === filter.accountId)) {
      return false
    }
    if (filter.projectId !== undefined && !entry.lines.some((line) => line.projectId === filter.projectId)) {
      return false
    }
    if (
      filter.householdMemberId !== undefined &&
      !entry.lines.some(
        (line) => resolveEffectiveHouseholdMemberId(line, accountsById, entry.householdMemberId) === filter.householdMemberId,
      )
    ) {
      return false
    }
    return true
  })
}
