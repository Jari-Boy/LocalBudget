import type { AccountCategory } from '../account/Account'
import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { RecurringTransactionRule } from './RecurringTransactionRule'

const PL_CATEGORIES: readonly AccountCategory[] = ['revenue', 'expense']

export interface BuildRecurringTransactionJournalEntryInputParams {
  rule: RecurringTransactionRule
  /** レビュー確認された対象日(docs/domain/recurring-transactions.md 1.2節)。仕訳のentryDateになる */
  dueDate: string
  /** 起票者(journal_entries.household_member_id相当)。解決は呼び出し側の責務 */
  bookkeeperHouseholdMemberId: number
  /** 借方科目の区分。counterparty_idの設置判定に使う。解決は呼び出し側の責務 */
  debitAccountCategory: AccountCategory
  /** 貸方科目の区分。同上 */
  creditAccountCategory: AccountCategory
  /** 省略時はrule.amountを使う。レビュー時の編集(2.1節、値上げ等の反映)に対応するための上書き */
  amount?: number
}

/**
 * 定期取引ルールから、確認済みの対象日1件分のCreateJournalEntryInputを組み立てる純粋関数
 * (docs/domain/recurring-transactions.md 1.4節)。project_id・household_member_id(ルール側の
 * 明細上書き)は両行に設定し、counterparty_idはPL区分(revenue/expense)側の行にのみ設定する
 * (両行ともBS区分の場合はどちらにも設定しない、3章の支払いルール等)。科目区分の解決は
 * 呼び出し側の責務(buildCounterpartyExpenseSplittingJournalEntryInput等の既存パターンを踏襲、
 * ドメイン層は他集約をDB参照しない)。
 */
export function buildRecurringTransactionJournalEntryInput(
  params: BuildRecurringTransactionJournalEntryInputParams,
): CreateJournalEntryInput {
  const {
    rule,
    dueDate,
    bookkeeperHouseholdMemberId,
    debitAccountCategory,
    creditAccountCategory,
  } = params
  const amount = params.amount ?? rule.amount

  return {
    entryDate: dueDate,
    sourceType: 'recurring_generated',
    generatedFromRuleId: rule.id,
    householdMemberId: bookkeeperHouseholdMemberId,
    lines: [
      {
        accountId: rule.debitAccountId,
        projectId: rule.projectId,
        householdMemberId: rule.householdMemberId,
        counterpartyId: PL_CATEGORIES.includes(debitAccountCategory) ? rule.counterpartyId : null,
        side: 'debit',
        amount,
      },
      {
        accountId: rule.creditAccountId,
        projectId: rule.projectId,
        householdMemberId: rule.householdMemberId,
        counterpartyId: PL_CATEGORIES.includes(creditAccountCategory) ? rule.counterpartyId : null,
        side: 'credit',
        amount,
      },
    ],
  }
}
