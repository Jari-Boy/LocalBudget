import { enumerateDueDates } from './enumerateDueDates'
import type { RecurringTransactionProposal } from './RecurringTransactionProposal'
import type { RecurringTransactionRule } from './RecurringTransactionRule'

export interface RecurringTransactionRuleGenerationState {
  rule: RecurringTransactionRule
  /** このルールから生成済みのjournal_entries件数(max_occurrences判定、2.1節) */
  generatedCount: number
  /**
   * このルールから生成済みの仕訳のうち最新のentry_date。1件も生成されていなければnull
   * (RecurringTransactionRuleRepository.findLatestGeneratedEntryDate参照)
   */
  latestGeneratedEntryDate: string | null
  /**
   * このルールで見送った対象日のうち最新のもの。1件も見送っていなければnull
   * (計画Issue #145、RecurringTransactionRuleRepository.findLatestSkippedDueDate参照)。
   * 見送りは仕訳を作らないため、生成済みの実績だけでは進捗を表現できない。確定と同じく
   * 古い順にしか見送れないので、最新の見送り日より前の対象日はすべて処理済みとみなせる。
   */
  latestSkippedDueDate: string | null
}

/**
 * 前回チェック日から現在日までの対象日を評価し、レビュー確認待ちの提案リストを算出する
 * 純粋関数(docs/domain/recurring-transactions.md 1.2節)。「前回チェック日」を専用のテーブル・
 * カラムとして永続化せず、ルールごとに「生成済みの仕訳のうち最新のentry_date(無ければ
 * ルールの作成日)」から逆算する設計にした。専用のチェックポイントを別途持つと、評価した
 * ものの未確認のまま次回起動を迎えた提案がチェックポイントの前進により再評価されなくなり
 * 消失しうる(確認済みかどうかを別途追跡する必要が生じる)。生成済みの実績(journal_entries)
 * を唯一の起点にすることで、未確認の提案は次回以降も同じ対象日として再評価され続け、
 * 消失しない。max_occurrencesの専用カウンタを持たない既存方針(2.1節)と同じ「二重管理を
 * 避ける」考え方(docs/decisions.md参照)。
 *
 * 見送り(計画Issue #145)は仕訳を作らないので、見送った最新の対象日も起点の候補に加え、
 * 生成済みの最新entry_dateと見送った最新の対象日のうち新しいほうを起点にする。
 * max_occurrencesの判定は生成済みの仕訳の件数のままで、見送りは回数に数えない
 * (見送った分だけ「N回で終わる」ルールの終わりが後ろへずれる)。
 *
 * 非アクティブなルールは新規の提案生成を停止する(1.6節)ため対象外にする。
 */
export function evaluateRecurringTransactionProposals(
  ruleStates: readonly RecurringTransactionRuleGenerationState[],
  today: string,
): RecurringTransactionProposal[] {
  const proposals: RecurringTransactionProposal[] = []

  for (const { rule, generatedCount, latestGeneratedEntryDate, latestSkippedDueDate } of ruleStates) {
    if (!rule.isActive) continue

    const processedUntil = [latestGeneratedEntryDate, latestSkippedDueDate]
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1)
    const since = processedUntil ?? rule.createdAt.slice(0, 10)
    const dueDates = enumerateDueDates(rule, { since, until: today }, generatedCount)
    for (const dueDate of dueDates) {
      proposals.push({ ruleId: rule.id, dueDate })
    }
  }

  return proposals
}
