import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { nextOccurrenceDate } from '../../domain/recurring-transaction/enumerateDueDates'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** YYYY-MM-DDの前日 */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - ONE_DAY_MS).toISOString().slice(0, 10)
}

/**
 * マスタ画面の定期取引の一覧に出す「次回」の日付(計画Issue #154)。今日を含む今日以降で
 * 最初にルールに合致する日(YYYY-MM-DD)を返す。無効なルールと、生成済みの件数が回数の上限に
 * 達したルールは次回が無いのでnullを返す。日付の計算はnextOccurrenceDate(月末への丸め等)に従う。
 */
export function nextRuleDate(rule: RecurringTransactionRule, today: string, generatedCount: number): string | null {
  if (!rule.isActive) return null
  if (rule.maxOccurrences !== null && generatedCount >= rule.maxOccurrences) return null
  try {
    return nextOccurrenceDate(rule, dayBefore(today))
  } catch {
    return null
  }
}
