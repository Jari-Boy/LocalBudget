import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { CreateSettlementBatchInput, SettlementBatch, UpdateSettlementBatchInput } from '../../domain/settlement-batch/SettlementBatch'
import {
  buildExpenseSplittingJournalEntryInputs,
  type ExpenseSplitRecipient,
} from '../../domain/expense-splitting/buildExpenseSplittingJournalEntryInputs'
import { findDebitExpenseLines } from '../../domain/expense-splitting/checkExpenseSplittability'
import { mergeExpenseSplittingJournalEntryInputs } from '../../domain/expense-splitting/mergeExpenseSplittingJournalEntryInputs'
import {
  splitRecipientsAcrossLines,
  toExpenseSplitRecipients,
  toExpenseSplitRecipientsForEntryAmount,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from './expenseSplittingFormParticipant'

export interface SubmitExpenseSplitRepositories {
  settlementBatchRepository: {
    create(input: CreateSettlementBatchInput): SettlementBatch | Promise<SettlementBatch>
    update(id: number, input: UpdateSettlementBatchInput): unknown
  }
  journalEntryRepository: {
    create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
  }
  journalEntryLinkGroupRepository: {
    joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void | Promise<void>
  }
}

export type SubmitExpenseSplitError =
  | 'expenseAccountNotFound'
  | 'requiredFieldMissing'
  | 'advanceLiabilityAccountRequired'
  | 'counterpartyTargetRequired'
  | 'noRecipient'

export type SubmitExpenseSplitResult =
  | { ok: true; createdEntries: JournalEntry[] }
  | { ok: false; error: SubmitExpenseSplitError }

export interface SubmitExpenseSplitParams {
  originalEntries: readonly JournalEntry[]
  accounts: readonly Account[]
  settlementBatches: readonly SettlementBatch[]
  participants: readonly ExpenseSplittingParticipantRow[]
  allocationMode: ExpenseSplittingAllocationMode
  /** 割勘仕訳の摘要。空欄なら無題。精算バッチを新規作成するときの名前にも使う */
  memo: string
  /** 既存の精算バッチのid、または'new'(新しく作る) */
  settlementBatchId: number | 'new'
  /** 割勘仕訳の取引日(YYYY-MM-DD) */
  today: string
  repositories: SubmitExpenseSplitRepositories
}

/**
 * 割勘タブの「割勘を記録」の起票処理(計画Issue #153)。旧割勘フォームのhandleSubmitを画面から
 * 切り出したもので、仕訳の組み立て方は変えない(docs/domain/expense-splitting.md 1.3・1.4節)。
 *
 * 検証に通らない入力は、精算バッチも仕訳も作らずにエラーを返す(バッチだけ作られて残るのを防ぐ)。
 * 分担相手(recipient)ごとに、選んだ元の仕訳すべての分を1件の複合仕訳にまとめる。異なる相手の
 * 立替金・未払金の行を同じ仕訳に混ぜないのは、精算がタグごとの残高で行われ、別の相手の残高まで
 * 消し込んでしまうのを防ぐため。世帯外の相手を含む割勘では、精算バッチの取引先に先頭の相手を設定する。
 * 割勘仕訳は元の仕訳と同じ関連仕訳グループへ合流させる(joinOrCreateGroups)。
 *
 * 金額指定('amount')は元の仕訳が1件のときだけ意味を持ち、入力した金額をそのまま使う。
 * 均等・割合は、元の仕訳(の費用の行)ごとに按分額を計算し直す。
 */
export async function submitExpenseSplit(params: SubmitExpenseSplitParams): Promise<SubmitExpenseSplitResult> {
  const { originalEntries, accounts, participants, allocationMode, memo, settlementBatchId, today, repositories } = params
  const isBatch = originalEntries.length > 1

  const advanceAssetAccountId = accounts.find((a) => a.category === 'asset' && a.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId = accounts.find((a) => a.category === 'liability' && a.isSystemManaged)?.id ?? null

  const entryLines = originalEntries.map((entry) => ({ entry, expenseLines: findDebitExpenseLines(entry, accounts) }))
  if (entryLines.some(({ expenseLines }) => expenseLines.length === 0)) {
    return { ok: false, error: 'expenseAccountNotFound' }
  }
  if (advanceAssetAccountId === null) return { ok: false, error: 'requiredFieldMissing' }
  if (
    participants.some((row) => row.kind === 'householdMember' && row.targetId !== null) &&
    advanceLiabilityAccountId === null
  ) {
    return { ok: false, error: 'advanceLiabilityAccountRequired' }
  }
  if (participants.some((row) => row.kind === 'counterparty' && row.targetId === null)) {
    return { ok: false, error: 'counterpartyTargetRequired' }
  }

  // 書き込みの前に、すべての元の仕訳の分担額を計算して検証する
  const useEnteredAmounts = allocationMode === 'amount' && !isBatch
  const recipientsPerEntry = entryLines.map(({ expenseLines }) =>
    useEnteredAmounts
      ? splitRecipientsAcrossLines(
          toExpenseSplitRecipients(participants, advanceLiabilityAccountId),
          expenseLines.map((l) => l.amount),
        )
      : expenseLines.map((l) =>
          toExpenseSplitRecipientsForEntryAmount(participants, advanceLiabilityAccountId, l.amount, allocationMode),
        ),
  )
  if (recipientsPerEntry.some((perLine) => perLine.every((recipients) => recipients.length === 0))) {
    return { ok: false, error: 'noRecipient' }
  }

  const firstCounterpartyId = participants.find((row) => row.kind === 'counterparty' && row.targetId !== null)?.targetId ?? null

  let resolvedSettlementBatchId: number
  if (settlementBatchId === 'new') {
    const created = await repositories.settlementBatchRepository.create({
      name: memo.trim(),
      type: 'expense_splitting',
      counterpartyId: firstCounterpartyId,
    })
    resolvedSettlementBatchId = created.id
  } else {
    resolvedSettlementBatchId = settlementBatchId
    const current = params.settlementBatches.find((b) => b.id === settlementBatchId)
    if (firstCounterpartyId !== null && current?.counterpartyId == null) {
      await repositories.settlementBatchRepository.update(settlementBatchId, { counterpartyId: firstCounterpartyId })
    }
  }

  const inputsByRecipientKey = new Map<string, CreateJournalEntryInput[]>()
  entryLines.forEach(({ entry, expenseLines }, entryIndex) => {
    expenseLines.forEach((expenseLine, lineIndex) => {
      const recipients: ExpenseSplitRecipient[] = recipientsPerEntry[entryIndex][lineIndex]
      if (recipients.length === 0) return
      const inputs = buildExpenseSplittingJournalEntryInputs({
        expenseAccountId: expenseLine.accountId,
        advanceAssetAccountId,
        fromMemberId: entry.householdMemberId,
        settlementBatchId: resolvedSettlementBatchId,
        eventProjectId: expenseLine.projectId,
        entryDate: today,
        recipients,
      })
      recipients.forEach((recipient, index) => {
        const key =
          recipient.kind === 'householdMember'
            ? `householdMember:${recipient.toMemberId}`
            : `counterparty:${recipient.counterpartyId}`
        inputsByRecipientKey.set(key, [...(inputsByRecipientKey.get(key) ?? []), inputs[index]])
      })
    })
  })

  const createdEntries: JournalEntry[] = []
  for (const inputs of inputsByRecipientKey.values()) {
    const createdEntry = await repositories.journalEntryRepository.create(
      mergeExpenseSplittingJournalEntryInputs({
        inputs,
        entryDate: today,
        memo: memo.trim() === '' ? null : memo,
        householdMemberId: originalEntries[0].householdMemberId,
      }),
    )
    createdEntries.push(createdEntry)
    await repositories.journalEntryLinkGroupRepository.joinOrCreateGroups(
      originalEntries.map((e) => e.id),
      [createdEntry.id],
    )
  }
  return { ok: true, createdEntries }
}
