import { adjustForWeekend } from './adjustForWeekend'
import { nextOccurrenceDate } from './enumerateDueDates'
import type { RecurringTransactionRule } from './RecurringTransactionRule'
import { effectiveMaxOccurrences } from './recurringAmountSchedule'

export interface UpcomingDueDate {
  /** 土日の調整前の期日 */
  dueDate: string
  /** 土日の調整後の日付(確定すると仕訳のentry_dateになる) */
  entryDate: string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * ルールの作成・編集フォームに出す「これからの期日」のプレビュー(計画Issue #164)を作る純粋関数。
 * 今日(を含む)以降の期日を、土日の調整後の日付とあわせて最大count件返す。開始日より前、終了日(当日を
 * 含む)より後、回数の上限(generatedCountを引いた残り)を超える期日は含めない。間隔は開始日を基準にした
 * 周期に従う。プレビューは保存せず、表示のたびにルールから再計算する(docs/domain/recurring-transactions.md
 * 1.2「見通し表示(先読みプレビュー)は永続化しない」)ため、起点(生成済み・見送り・再開日)は考慮しない。
 */
export function previewUpcomingDueDates(
  rule: RecurringTransactionRule,
  today: string,
  count: number,
  generatedCount = 0,
): UpcomingDueDate[] {
  const max = effectiveMaxOccurrences(rule)
  const remaining = max === null ? Infinity : Math.max(0, max - generatedCount)
  const limit = Math.min(count, remaining)

  const results: UpcomingDueDate[] = []
  let cursor = new Date(Date.parse(`${today}T00:00:00Z`) - ONE_DAY_MS).toISOString().slice(0, 10)
  while (results.length < limit) {
    let next: string
    try {
      next = nextOccurrenceDate(rule, cursor)
    } catch {
      break
    }
    if (rule.endsOn !== null && next > rule.endsOn) break
    results.push({ dueDate: next, entryDate: adjustForWeekend(next, rule.weekendAdjustment) })
    cursor = next
  }
  return results
}
