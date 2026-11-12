import type { RecurringTransactionRuleLineInput } from './RecurringTransactionRule'

/**
 * 「借方1科目・貸方1科目・同額」の2行のルールの行を作る補助関数(計画Issue #180)。
 * 2行のルールも3行以上のルールと同じ表(recurring_transaction_rule_lines)で表すため、特別扱いはしない。
 * extraは両行に同じ値を設定する(プロジェクト・世帯メンバー・取引先など)。取引先はPL区分の行にしか
 * 設定できないため、必要な側の行は呼び出し側が直接組み立てる
 */
export function twoLineRuleLines(
  debitAccountId: number,
  creditAccountId: number,
  amount: number,
): RecurringTransactionRuleLineInput[] {
  return [
    { side: 'debit', accountId: debitAccountId, amount },
    { side: 'credit', accountId: creditAccountId, amount },
  ]
}
