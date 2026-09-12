/**
 * 定期取引ルールの対象日評価により算出される、レビュー確認待ちの提案(docs/domain/recurring-transactions.md 1.2)。
 * 提案データ自体は永続化しない(evaluateRecurringTransactionProposals参照)。
 */
export interface RecurringTransactionProposal {
  ruleId: number
  dueDate: string
}
