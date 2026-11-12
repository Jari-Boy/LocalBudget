import type {
  CreateRecurringTransactionRuleInput,
  RecurringTransactionRule,
  UpdateRecurringTransactionRuleInput,
} from './RecurringTransactionRule'
import type { LastConfirmedLine } from './resolveLastConfirmedLines'

/**
 * 定期仕訳ルール(recurring_transaction_rules)とその行(recurring_transaction_rule_lines、計画Issue #180)の永続化を担うRepositoryのポート(インターフェース)。
 * frequencyごとのカラム組み合わせ検証(assertValidRecurringSchedule)は実装(インフラ層)が
 * create/update時に書き込み前に必ず呼び出し、違反時はInvalidRecurringScheduleErrorを投げて
 * DBに一切書き込まない(docs/domain/recurring-transactions.md 1.3、
 * SqlJsJournalEntryRepositoryのassertJournalBalanceと同じ使い分け)。
 * 生成済み仕訳がある場合の物理削除禁止等、DBルックアップを要する制約はDDL側(docs/schema/recurring_transactions.sql)で強制されるため、
 * 実装はそちらの制約違反例外をそのまま呼び出し元に伝播させる。
 * 生成済み件数(max_occurrences判定用)はjournal_entries.generated_from_rule_idのCOUNTから
 * 算出し、専用のカウンタは持たない(2.1節参照)。開始日・終了日・間隔・土日の調整・金額の初期値の
 * 書き込み前検証(間隔は1以上、終了日は開始日以後)もassertValidRecurringScheduleが担う(計画Issue #164)。
 */
export interface RecurringTransactionRuleRepository {
  create(input: CreateRecurringTransactionRuleInput): RecurringTransactionRule
  findById(id: number): RecurringTransactionRule | null
  findAll(): RecurringTransactionRule[]
  update(id: number, input: UpdateRecurringTransactionRuleInput): RecurringTransactionRule
  delete(id: number): void

  /** 新規の提案生成のみ停止する(過去生成分の仕訳はそのまま残る、1.6節参照) */
  deactivate(id: number): RecurringTransactionRule

  /**
   * 無効なルールを有効に戻し、再開日(YYYY-MM-DD、当日を含む)を記録する(計画Issue #164)。過去日も
   * 指定できる。終了したルール(終了日の経過・回数の上限への到達)は再有効化できずエラーになる
   * (延長したいときは終了日を編集する)。todayは終了日の判定に使う今日(省略時はシステム日付)。
   * すでに有効なルールに呼んでも再開日が更新されるだけで、生成済みの仕訳には影響しない
   */
  activate(id: number, resumedOn: string, today?: string): RecurringTransactionRule

  /** このルールから生成済みのjournal_entries件数(max_occurrences判定に使用、2.1節参照) */
  countGeneratedJournalEntries(id: number): number

  /**
   * このルールから生成済みのjournal_entriesのうち最新の期日(土日の調整前、recurring_due_date)。
   * 1件も生成されていなければnull。提案評価の起点(1.2節)として使う。entry_dateは仕訳の編集や土日の
   * 調整で動くため使わない(計画Issue #164)。専用のチェックポイントを別途永続化せずjournal_entriesから
   * 逆算する設計判断はdocs/decisions.md参照(max_occurrencesの専用カウンタを持たない既存方針と同じ
   * 「二重管理を避ける」考え方)
   */
  findLatestGeneratedDueDate(id: number): string | null

  /**
   * 前回確定した仕訳の行(計画Issue #164・#180、amount_mode = last_confirmed)。期日(recurring_due_date)が
   * 最も新しい生成済みの仕訳の行(科目・借方/貸方・金額)。1件も生成されていなければ空配列
   * (呼び出し側がルールの金額を使う)。ルールの行との対応づけは resolveLastConfirmedLines が行う
   */
  findLastConfirmedLines(id: number): LastConfirmedLine[]

  /**
   * 提案を見送った対象日を記録する(計画Issue #145)。仕訳は作らない。同じルール・同じ対象日の
   * 二重記録はエラー。古い順にしか見送れない検証は呼び出し側(提案API)の責務
   */
  recordSkip(id: number, dueDate: string): void

  /** このルールで見送った対象日のうち最新のもの。1件も見送っていなければnull(提案評価の起点に使う) */
  findLatestSkippedDueDate(id: number): string | null
}
