import { enumerateDueDates } from './enumerateDueDates'
import type { RecurringTransactionProposal } from './RecurringTransactionProposal'
import type { RecurringTransactionRule } from './RecurringTransactionRule'

export interface RecurringTransactionRuleGenerationState {
  rule: RecurringTransactionRule
  /** このルールから生成済みのjournal_entries件数(max_occurrences判定、2.1節) */
  generatedCount: number
  /**
   * このルールから生成済みの仕訳のうち最新の期日(土日の調整前、journal_entries.recurring_due_date)。
   * 1件も生成されていなければnull(RecurringTransactionRuleRepository.findLatestGeneratedDueDate参照)。
   * 仕訳のentry_dateは編集や土日の調整で動くため、起点には使わない(計画Issue #164)
   */
  latestGeneratedDueDate: string | null
  /**
   * このルールで見送った対象日のうち最新のもの。1件も見送っていなければnull
   * (計画Issue #145、RecurringTransactionRuleRepository.findLatestSkippedDueDate参照)。
   * 見送りは仕訳を作らないため、生成済みの実績だけでは進捗を表現できない。確定と同じく
   * 古い順にしか見送れないので、最新の見送り日より前の対象日はすべて処理済みとみなせる。
   */
  latestSkippedDueDate: string | null
}

/**
 * レビュー確認待ちの提案を算出する純粋関数(docs/domain/recurring-transactions.md 1.2節)。
 * 「前回チェック日」を専用のテーブル・カラムとして永続化せず、ルールごとに次の4つのうち最も新しい日
 * を起点として逆算する(計画Issue #164)。起点より後(exclusive)で今日までの対象日が提案になる。
 * - 生成済みの仕訳の最新の期日(recurring_due_date。entry_dateではない)
 * - 見送った最新の対象日(計画Issue #145。見送りは仕訳を作らないため進捗を表現できず、起点に含める)
 * - 開始日の前日(開始日の当日が期日なら提案に出す)
 * - 再開日の前日(再有効化の再開日。既定の今日なら無効にしていた間の提案は出ず、過去日なら出る)
 * 専用のチェックポイントを別途持つと、評価したものの未確認のまま次回起動を迎えた提案がチェック
 * ポイントの前進により再評価されなくなり消失しうる。生成済みの実績を起点にすることで、未確認の提案は
 * 次回以降も同じ対象日として再評価され続け、消失しない。max_occurrencesの専用カウンタを持たない既存
 * 方針(2.1節)と同じ「二重管理を避ける」考え方(docs/decisions.md参照)。
 *
 * 提案の対象日は土日の調整前の期日のまま返す(調整後の日付は仕訳のentry_dateとして確定時に使う)。
 * 間隔の周期は開始日が基準で、起点には依存しないので、再開しても周期はずれない。
 * max_occurrencesの判定は生成済みの仕訳の件数のままで、見送りは回数に数えない。
 * 終了日を過ぎた対象日は提案しない。
 *
 * 非アクティブなルールは新規の提案生成を停止する(1.6節)ため対象外にする。
 */
export function evaluateRecurringTransactionProposals(
  ruleStates: readonly RecurringTransactionRuleGenerationState[],
  today: string,
): RecurringTransactionProposal[] {
  const proposals: RecurringTransactionProposal[] = []

  for (const { rule, generatedCount, latestGeneratedDueDate, latestSkippedDueDate } of ruleStates) {
    if (!rule.isActive) continue

    const since = [
      latestGeneratedDueDate,
      latestSkippedDueDate,
      dayBefore(rule.startsOn),
      rule.resumedOn === null ? null : dayBefore(rule.resumedOn),
    ]
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1)!
    const dueDates = enumerateDueDates(rule, { since, until: today }, generatedCount)
    for (const dueDate of dueDates) {
      proposals.push({ ruleId: rule.id, dueDate })
    }
  }

  return proposals
}

function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}
