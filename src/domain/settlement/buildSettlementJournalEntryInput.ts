import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { AccountCategory } from '../account/Account'
import type { LineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'

export interface BuildSettlementJournalEntryInputParams {
  /** 消込対象の精算バッチのid(docs/domain/settlement.md、計画Issue #133) */
  settlementBatchId: number
  /** 一時勘定(立替金)科目のid */
  settlementAccountId: number
  /** 一時勘定科目の区分。借方/貸方の組み立てを左右する */
  settlementAccountCategory: Extract<AccountCategory, 'asset' | 'liability'>
  /** 実際の入出金が発生した口座科目のid(精算画面(計画Issue #139)では差額計上先の雑収入/雑損失科目) */
  counterAccountId: number
  amount: number
  /**
   * 一時勘定行のhousehold_member_id(誰の立替金・未払金の残高か)。必須。
   * journal_lines.counterparty_idは資産・負債の行に設定できないため、世帯外の相手(取引先)の
   * バッチでも世帯メンバーの行として表す(docs/domain/counterparties.md 1.2、計画Issue #169)。
   */
  settlementHouseholdMemberId: number
  /** 仕訳の起票者(CreateJournalEntryInput.householdMemberId、NOT NULL) */
  entryHouseholdMemberId: number
  entryDate: string
  memo?: string | null
  /**
   * 明細行の世帯メンバーの決め方(科目の既定メンバー > 指定 > 起票者、計画Issue #169)。
   * 科目と起票者を知っている呼び出し側が createLineHouseholdMemberResolver で作って渡す
   */
  resolveLineHouseholdMemberId: LineHouseholdMemberResolver
}

/**
 * 精算(立替金の消込)仕訳を生成する純粋関数(docs/domain/expense-splitting.md 1.3節の
 * 精算1・精算2)。一時勘定の区分に応じて借方/貸方を入れ替える。
 * - liability(立替金負債の消込、精算1): 一時勘定を借方(負債の減少)、口座を貸方にする
 * - asset(立替金資産の消込、精算2): 口座を借方、一時勘定を貸方(資産の減少)にする
 *
 * 一時勘定行には`settlementBatchId`を付与するのみで、journal_entry_linksによる明示的な
 * リンクは作らない(計画Issue #133)。未精算残高は`settlement_batch_id`・科目・世帯メンバー/
 * 取引先でグルーピングした集計方式(calculateSettlementBatchBalance)で算出されるため、
 * タグを正しく付与するだけで消込が成立する。
 *
 * 計画Issue #139で、精算画面の「金額不一致時に差額を損益計上して精算完了する」操作
 * (counterAccountIdに雑収入/雑損失科目を渡す)にも再利用する。一時勘定行の世帯メンバー
 * (settlementHouseholdMemberId)と仕訳の起票者(entryHouseholdMemberId)は別パラメータ。
 * 相手科目の行の世帯メンバーは、科目の既定メンバーがあればそれ、無ければ起票者になる(計画Issue #169)。
 */
export function buildSettlementJournalEntryInput(
  params: BuildSettlementJournalEntryInputParams,
): CreateJournalEntryInput {
  const settlementLine = {
    accountId: params.settlementAccountId,
    settlementBatchId: params.settlementBatchId,
    householdMemberId: params.resolveLineHouseholdMemberId(
      params.settlementAccountId,
      params.settlementHouseholdMemberId,
    ),
    amount: params.amount,
  }
  const counterLine = {
    accountId: params.counterAccountId,
    householdMemberId: params.resolveLineHouseholdMemberId(params.counterAccountId),
    amount: params.amount,
  }

  const lines =
    params.settlementAccountCategory === 'liability'
      ? [
          { ...settlementLine, side: 'debit' as const },
          { ...counterLine, side: 'credit' as const },
        ]
      : [
          { ...counterLine, side: 'debit' as const },
          { ...settlementLine, side: 'credit' as const },
        ]

  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    householdMemberId: params.entryHouseholdMemberId,
    lines,
  }
}
