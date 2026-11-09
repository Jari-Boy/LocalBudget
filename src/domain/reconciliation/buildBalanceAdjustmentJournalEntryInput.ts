import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { LineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'
import { NoBalanceDiscrepancyError } from './NoBalanceDiscrepancyError'

export interface BuildBalanceAdjustmentJournalEntryInputParams {
  /** 照合対象の科目(is_reconcilable = trueの資産科目) */
  targetAccountId: number
  /** 相手科目「費用・残高調整」のid。科目自体の解決(名前検索・作成)は呼び出し側の責務(#20決定済み) */
  adjustmentAccountId: number
  bookBalance: number
  externalBalance: number
  entryDate: string
  /** 起票者(CreateJournalEntryInput.householdMemberId、計画Issue #88)。解決は呼び出し側の責務 */
  householdMemberId: number
  memo?: string | null
  /**
   * 明細行の世帯メンバーの決め方(科目の既定メンバー > 指定 > 起票者、計画Issue #169)。
   * 科目と起票者を知っている呼び出し側が createLineHouseholdMemberResolver で作って渡す
   */
  resolveLineHouseholdMemberId: LineHouseholdMemberResolver
}

/**
 * 原因不明差異への残高調整仕訳(docs/domain/reconciliation.md 1.6・
 * docs/domain/financial-statements.md 1.2)を生成する純粋関数。ユーザーが差額を確定すると
 * 明示的に選んだ場合のみ呼び出される想定で、JournalEntryRepository.create()にそのまま渡せる
 * CreateJournalEntryInput(source_type = 'balance_adjustment')を組み立てる。
 * 対象科目は現状is_reconcilable = trueの資産科目のみ(debit-increase)であり、相手科目の
 * 「費用・残高調整」もexpense区分(debit-increase)であるため、区分ごとの向き反転は不要(1.2)。
 *
 * 過不足の向き: 帳簿残高が外部残高より大きい(超過)場合は対象科目を貸方に減額計上し、
 * 小さい(不足)場合は対象科目を借方に増額計上する(financial-statements.md 1.2の例と対応)。
 * 差異が無い場合は呼び出し側の誤りとみなしNoBalanceDiscrepancyErrorをスローする。
 */
export function buildBalanceAdjustmentJournalEntryInput(
  params: BuildBalanceAdjustmentJournalEntryInputParams,
): CreateJournalEntryInput {
  const difference = params.externalBalance - params.bookBalance
  if (difference === 0) {
    throw new NoBalanceDiscrepancyError()
  }

  const amount = Math.abs(difference)
  const target = {
    accountId: params.targetAccountId,
    householdMemberId: params.resolveLineHouseholdMemberId(params.targetAccountId),
    amount,
  }
  const adjustment = {
    accountId: params.adjustmentAccountId,
    householdMemberId: params.resolveLineHouseholdMemberId(params.adjustmentAccountId),
    amount,
  }
  const lines =
    difference > 0
      ? [
          { ...target, side: 'debit' as const },
          { ...adjustment, side: 'credit' as const },
        ]
      : [
          { ...adjustment, side: 'debit' as const },
          { ...target, side: 'credit' as const },
        ]

  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    sourceType: 'balance_adjustment',
    householdMemberId: params.householdMemberId,
    lines,
  }
}
