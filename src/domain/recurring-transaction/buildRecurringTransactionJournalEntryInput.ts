import type { AccountCategory } from '../account/Account'
import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { LineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'
import { adjustForWeekend } from './adjustForWeekend'
import type { RecurringTransactionRule } from './RecurringTransactionRule'

const PL_CATEGORIES: readonly AccountCategory[] = ['revenue', 'expense']

export interface BuildRecurringTransactionJournalEntryInputParams {
  rule: RecurringTransactionRule
  /**
   * レビュー確認された対象日(土日の調整前の期日、docs/domain/recurring-transactions.md 1.2節)。
   * recurringDueDateに記録し、土日の調整後の日付が仕訳のentryDateになる(計画Issue #164)
   */
  dueDate: string
  /** 摘要(計画Issue #164)。省略時はルール名。空(空白のみ)ならnull */
  memo?: string | null
  /** コメント(計画Issue #164)。省略時はnull */
  comment?: string | null
  /** 起票者(journal_entries.household_member_id相当)。解決は呼び出し側の責務 */
  bookkeeperHouseholdMemberId: number
  /** 借方科目の区分。counterparty_idの設置判定に使う。解決は呼び出し側の責務 */
  debitAccountCategory: AccountCategory
  /** 貸方科目の区分。同上 */
  creditAccountCategory: AccountCategory
  /** 省略時はrule.amountを使う。レビュー時の編集(2.1節、値上げ等の反映)に対応するための上書き */
  amount?: number
  /**
   * 明細行の世帯メンバーの決め方(科目の既定メンバー > 指定 > 起票者、計画Issue #169)。
   * 科目と起票者を知っている呼び出し側が createLineHouseholdMemberResolver で作って渡す
   */
  resolveLineHouseholdMemberId: LineHouseholdMemberResolver
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
    resolveLineHouseholdMemberId,
  } = params
  const amount = params.amount ?? rule.amount

  return {
    entryDate: adjustForWeekend(dueDate, rule.weekendAdjustment),
    memo: normalizeText(params.memo === undefined ? rule.name : params.memo),
    comment: normalizeText(params.comment),
    recurringDueDate: dueDate,
    sourceType: 'recurring_generated',
    generatedFromRuleId: rule.id,
    householdMemberId: bookkeeperHouseholdMemberId,
    lines: [
      {
        accountId: rule.debitAccountId,
        projectId: rule.projectId,
        householdMemberId: resolveLineHouseholdMemberId(rule.debitAccountId, rule.householdMemberId),
        counterpartyId: PL_CATEGORIES.includes(debitAccountCategory) ? rule.counterpartyId : null,
        side: 'debit',
        amount,
      },
      {
        accountId: rule.creditAccountId,
        projectId: rule.projectId,
        householdMemberId: resolveLineHouseholdMemberId(rule.creditAccountId, rule.householdMemberId),
        counterpartyId: PL_CATEGORIES.includes(creditAccountCategory) ? rule.counterpartyId : null,
        side: 'credit',
        amount,
      },
    ],
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}
