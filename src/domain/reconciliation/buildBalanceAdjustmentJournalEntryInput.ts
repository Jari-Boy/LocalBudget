import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import { NoBalanceDiscrepancyError } from './NoBalanceDiscrepancyError'

export interface BuildBalanceAdjustmentJournalEntryInputParams {
  /** 照合対象の科目(is_reconcilable = trueの資産科目) */
  targetAccountId: number
  /** 相手科目「費用・残高調整」のid。科目自体の解決(名前検索・作成)は呼び出し側の責務(#20決定済み) */
  adjustmentAccountId: number
  bookBalance: number
  externalBalance: number
  entryDate: string
  memo?: string | null
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
  const lines =
    difference > 0
      ? [
          { accountId: params.targetAccountId, side: 'debit' as const, amount },
          { accountId: params.adjustmentAccountId, side: 'credit' as const, amount },
        ]
      : [
          { accountId: params.adjustmentAccountId, side: 'debit' as const, amount },
          { accountId: params.targetAccountId, side: 'credit' as const, amount },
        ]

  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    sourceType: 'balance_adjustment',
    lines,
  }
}
