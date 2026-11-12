import type { AccountCategory } from '../account/Account'
import type { CreateJournalEntryInput, JournalLineInput } from '../journal/JournalEntry'
import type { LineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'
import { adjustForWeekend } from './adjustForWeekend'
import type { RecurringTransactionRule } from './RecurringTransactionRule'

const PL_CATEGORIES: readonly AccountCategory[] = ['revenue', 'expense']

/** 確認パネルで編集した行(ルールの行の代わりに仕訳へ使う)。行の世帯メンバーが無ければ科目の既定・起票者で決まる */
export type EditedRecurringJournalLine = Omit<JournalLineInput, 'id' | 'householdMemberId'> & {
  householdMemberId?: number | null
}

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
  /** 起票者(journal_entries.household_member_id相当)。ルールの起票者の解決は呼び出し側の責務 */
  bookkeeperHouseholdMemberId: number
  /** 科目idから区分への対応。counterparty_idの設置判定に使う。解決は呼び出し側の責務 */
  accountCategoryById: ReadonlyMap<number, AccountCategory>
  /**
   * 行番号ごとの金額の上書き(前回確定額・金額表の初期値、計画Issue #180)。
   * 指定のない行はルールの行の金額を使う
   */
  lineAmounts?: ReadonlyMap<number, number>
  /**
   * 確認パネルで編集した行(計画Issue #180)。渡すと、ルールの行の代わりにこの行で仕訳を作る
   * (科目・金額の変更、行の追加・削除)。貸借の検証は仕訳のRepositoryが行う
   */
  lines?: readonly EditedRecurringJournalLine[]
  /**
   * 明細行の世帯メンバーの決め方(科目の既定メンバー > 行の世帯メンバー > 起票者、計画Issue #169・#180)。
   * 科目と起票者を知っている呼び出し側が createLineHouseholdMemberResolver で作って渡す
   */
  resolveLineHouseholdMemberId: LineHouseholdMemberResolver
}

/**
 * 定期仕訳ルールから、確認済みの対象日1件分のCreateJournalEntryInputを組み立てる純粋関数
 * (docs/domain/recurring-transactions.md 1.4節)。ルールの行(2行でも3行以上でも同じ)を仕訳の明細行へ
 * 写し、counterparty_idはPL区分(revenue/expense)の行にだけ設定する(それ以外の行では設定しない)。
 * 金額が0の行(金額表で利息が0の回など)は仕訳に含めない(計画Issue #180)。
 * 科目区分の解決は呼び出し側の責務(buildCounterpartyExpenseSplittingJournalEntryInput等の既存パターンを
 * 踏襲、ドメイン層は他集約をDB参照しない)。
 */
export function buildRecurringTransactionJournalEntryInput(
  params: BuildRecurringTransactionJournalEntryInputParams,
): CreateJournalEntryInput {
  const { rule, dueDate, bookkeeperHouseholdMemberId, accountCategoryById, resolveLineHouseholdMemberId } = params

  const lines: JournalLineInput[] =
    params.lines !== undefined
      ? params.lines.map((l) => ({
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          projectId: l.projectId ?? null,
          householdMemberId: resolveLineHouseholdMemberId(l.accountId, l.householdMemberId),
          counterpartyId: l.counterpartyId ?? null,
          settlementBatchId: l.settlementBatchId ?? null,
        }))
      : rule.lines
          .filter((l) => (params.lineAmounts?.get(l.lineNo) ?? l.amount) > 0)
          .map((l) => ({
            accountId: l.accountId,
            side: l.side,
            amount: params.lineAmounts?.get(l.lineNo) ?? l.amount,
            projectId: l.projectId,
            householdMemberId: resolveLineHouseholdMemberId(l.accountId, l.householdMemberId),
            counterpartyId: isPlAccount(accountCategoryById.get(l.accountId)) ? l.counterpartyId : null,
            settlementBatchId: l.settlementBatchId,
          }))

  return {
    entryDate: adjustForWeekend(dueDate, rule.weekendAdjustment),
    memo: normalizeText(params.memo === undefined ? rule.name : params.memo),
    comment: normalizeText(params.comment),
    recurringDueDate: dueDate,
    sourceType: 'recurring_generated',
    generatedFromRuleId: rule.id,
    householdMemberId: bookkeeperHouseholdMemberId,
    lines,
  }
}

function isPlAccount(category: AccountCategory | undefined): boolean {
  return category !== undefined && PL_CATEGORIES.includes(category)
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}
