import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { adjustForWeekend } from '../../domain/recurring-transaction/adjustForWeekend'
import { nextOccurrenceDate } from '../../domain/recurring-transaction/enumerateDueDates'
import { isRecurringRuleEnded } from '../../domain/recurring-transaction/isRecurringRuleEnded'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** YYYY-MM-DDの前日 */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - ONE_DAY_MS).toISOString().slice(0, 10)
}

/**
 * マスタ画面の定期取引の一覧に出す「次回」の日付(計画Issue #154)。今日を含む今日以降で
 * 最初にルールに合致する日(YYYY-MM-DD)を、土日の調整後の日付で返す(計画Issue #164)。無効なルールと、
 * 終了したルール(終了日を過ぎた、生成済みの件数が回数の上限に達した)、終了日より後にしか期日が無い
 * ルールは次回が無いのでnullを返す。日付の計算はnextOccurrenceDate(月末への丸め、開始日以降、間隔の
 * 周期)に従う。
 */
export function nextRuleDate(rule: RecurringTransactionRule, today: string, generatedCount: number): string | null {
  if (!rule.isActive) return null
  if (isRecurringRuleEnded(rule, generatedCount, today)) return null
  try {
    const next = nextOccurrenceDate(rule, dayBefore(today))
    if (rule.endsOn !== null && next > rule.endsOn) return null
    return adjustForWeekend(next, rule.weekendAdjustment)
  } catch {
    return null
  }
}
