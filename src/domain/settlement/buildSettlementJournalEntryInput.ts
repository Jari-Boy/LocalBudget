import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { AccountCategory } from '../account/Account'

export interface BuildSettlementJournalEntryInputParams {
  /** 消込対象の精算バッチのid(docs/domain/settlement.md、計画Issue #133) */
  settlementBatchId: number
  /** 一時勘定(立替金)科目のid */
  settlementAccountId: number
  /** 一時勘定科目の区分。借方/貸方の組み立てを左右する */
  settlementAccountCategory: Extract<AccountCategory, 'asset' | 'liability'>
  /** 実際の入出金が発生した口座科目のid */
  counterAccountId: number
  amount: number
  /** 精算する当人(一時勘定行のhousehold_member_id、精算仕訳の起票者にもなる) */
  householdMemberId: number
  entryDate: string
  memo?: string | null
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
 */
export function buildSettlementJournalEntryInput(
  params: BuildSettlementJournalEntryInputParams,
): CreateJournalEntryInput {
  const settlementLine = {
    accountId: params.settlementAccountId,
    settlementBatchId: params.settlementBatchId,
    householdMemberId: params.householdMemberId,
    amount: params.amount,
  }
  const counterLine = { accountId: params.counterAccountId, amount: params.amount }

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
    householdMemberId: params.householdMemberId,
    lines,
  }
}
