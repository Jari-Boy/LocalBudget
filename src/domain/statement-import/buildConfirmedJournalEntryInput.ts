import type { AccountCategory } from '../account/Account'
import type { CreateJournalEntryInput, JournalLineSide } from '../journal/JournalEntry'
import type { ImportedRecord } from './ImportedRecord'

export interface BuildConfirmedJournalEntryInputParams {
  record: ImportedRecord
  /** resolveExternalIdsで解決済みの外部取引ID(CSV由来またはハッシュ代替) */
  externalId: string
  /** 取込対象として選んだ科目(docs/domain/statement-import.md 1.5 手順1) */
  targetAccountId: number
  targetAccountCategory: AccountCategory
  /** レビュー確定でユーザーが選んだ相手勘定科目 */
  counterAccountId: number
  counterpartyId?: number | null
  projectId?: number | null
  householdMemberId?: number | null
}

/**
 * レビュー確定(docs/domain/statement-import.md 1.5 手順6-7)の内容から、
 * JournalEntryRepository.create()にそのまま渡せるCreateJournalEntryInputを組み立てる。
 * ImportedRecord.amountは「正 = 対象科目の残高が増える方向」を表す符号付き整数であり、
 * 借方/貸方への変換は科目区分によって向きが反転する(1.2の注記: assetは借方増加、
 * liabilityは貸方増加)。external_transaction_refsは同一トランザクションで書き込むため
 * externalTransactionRefとして埋め込む(reconciliation.md 2章)。
 */
export function buildConfirmedJournalEntryInput(
  params: BuildConfirmedJournalEntryInputParams,
): CreateJournalEntryInput {
  const { record } = params
  const amount = Math.abs(record.amount)
  const targetSide = determineTargetSide(params.targetAccountCategory, record.amount)
  const counterSide: JournalLineSide = targetSide === 'debit' ? 'credit' : 'debit'

  const targetLine = { accountId: params.targetAccountId, side: targetSide, amount }
  const counterLine = {
    accountId: params.counterAccountId,
    side: counterSide,
    amount,
    counterpartyId: params.counterpartyId ?? null,
    projectId: params.projectId ?? null,
    householdMemberId: params.householdMemberId ?? null,
  }

  return {
    entryDate: record.entryDate,
    memo: record.description,
    sourceType: 'external_import',
    lines: counterSide === 'debit' ? [counterLine, targetLine] : [targetLine, counterLine],
    externalTransactionRef: {
      accountId: params.targetAccountId,
      externalId: params.externalId,
      entryDate: record.entryDate,
      description: record.description,
      amount: record.amount,
      externalBalanceAfter: record.balanceAfter,
      isSettled: record.isSettled,
    },
  }
}

function determineTargetSide(category: AccountCategory, amount: number): JournalLineSide {
  const increases = amount >= 0
  const isDebitIncreaseCategory = category === 'asset' || category === 'expense'
  if (isDebitIncreaseCategory) {
    return increases ? 'debit' : 'credit'
  }
  return increases ? 'credit' : 'debit'
}
