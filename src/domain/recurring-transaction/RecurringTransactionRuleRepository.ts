import type {
  CreateRecurringTransactionRuleInput,
  RecurringTransactionRule,
  UpdateRecurringTransactionRuleInput,
} from './RecurringTransactionRule'

/**
 * 定期取引ルール(recurring_transaction_rules)の永続化を担うRepositoryのポート(インターフェース)。
 * frequencyごとのカラム組み合わせ検証(assertValidRecurringSchedule)は実装(インフラ層)が
 * create/update時に書き込み前に必ず呼び出し、違反時はInvalidRecurringScheduleErrorを投げて
 * DBに一切書き込まない(docs/domain/recurring-transactions.md 1.3、
 * SqlJsJournalEntryRepositoryのassertJournalBalanceと同じ使い分け)。
 * is_reconcilable科目を借方/貸方に指定できない制約・生成済み仕訳がある場合の物理削除禁止等、
 * DBルックアップを要する制約はDDL側(docs/schema/recurring_transactions.sql)で強制されるため、
 * 実装はそちらの制約違反例外をそのまま呼び出し元に伝播させる。
 * 生成済み件数(max_occurrences判定用)はjournal_entries.generated_from_rule_idのCOUNTから
 * 算出し、専用のカウンタは持たない(2.1節参照)。
 */
export interface RecurringTransactionRuleRepository {
  create(input: CreateRecurringTransactionRuleInput): RecurringTransactionRule
  findById(id: number): RecurringTransactionRule | null
  findAll(): RecurringTransactionRule[]
  update(id: number, input: UpdateRecurringTransactionRuleInput): RecurringTransactionRule
  delete(id: number): void

  /** 新規の提案生成のみ停止する(過去生成分の仕訳はそのまま残る、1.6節参照) */
  deactivate(id: number): RecurringTransactionRule

  /** このルールから生成済みのjournal_entries件数(max_occurrences判定に使用、2.1節参照) */
  countGeneratedJournalEntries(id: number): number
}
