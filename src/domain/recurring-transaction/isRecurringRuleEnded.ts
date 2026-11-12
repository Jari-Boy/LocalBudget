import type { RecurringTransactionRule } from './RecurringTransactionRule'
import { effectiveMaxOccurrences } from './recurringAmountSchedule'

/**
 * ルールが終了しているかを判定する純粋関数(計画Issue #164、docs/domain/recurring-transactions.md 1.6)。
 * 終了日が過ぎた(終了日の当日はまだ終了していない)か、生成済み件数が回数の上限に達したら終了。
 * is_activeとは独立で、終了しても is_active は変えない(無効化したのか自然に終わったのかを区別する)。
 * 金額表のルールは、表の最後の回まで生成したら終了する(回数の上限は表の長さに自動で揃う、計画Issue #180)。
 * 終了したルールは再有効化の対象外で、延長したいときは終了日(や回数の上限)を編集する。
 */
export function isRecurringRuleEnded(
  rule: Pick<RecurringTransactionRule, 'endsOn' | 'maxOccurrences' | 'amountMode' | 'schedule'>,
  generatedCount: number,
  today: string,
): boolean {
  if (rule.endsOn !== null && today > rule.endsOn) return true
  const max = effectiveMaxOccurrences(rule)
  return max !== null && generatedCount >= max
}
