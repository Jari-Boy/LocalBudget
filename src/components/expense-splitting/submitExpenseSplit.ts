import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { CreateSettlementBatchInput, SettlementBatch, UpdateSettlementBatchInput } from '../../domain/settlement-batch/SettlementBatch'
import {
  buildLineExpenseSplittingJournalEntryInput,
  type LineExpenseSplitRecipient,
  type LineExpenseSplitShare,
} from '../../domain/expense-splitting/buildLineExpenseSplittingJournalEntryInput'
import type { ExpenseSplittingAllocationMode, ExpenseSplittingParticipantRow } from './expenseSplittingFormParticipant'
import { planLineExpenseSplit, type PlanLineExpenseSplitError, type SelectedSplitLine } from './planLineExpenseSplit'

export type { SelectedSplitLine }

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
  | PlanLineExpenseSplitError
  | 'requiredFieldMissing'
  | 'advanceLiabilityAccountRequired'
  | 'counterpartyTargetRequired'

export type SubmitExpenseSplitResult =
  | { ok: true; createdEntries: JournalEntry[] }
  | { ok: false; error: SubmitExpenseSplitError }

export interface SubmitExpenseSplitParams {
  /** 割勘する行(費用・収益の行。借方・貸方とも) */
  selectedLines: readonly SelectedSplitLine[]
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
 * 割勘タブの「割勘を記録」の起票処理(計画Issue #153。計画Issue #271で、仕訳単位から選んだ明細行単位にした)。
 * 仕訳の組み立ては docs/domain/expense-splitting.md の1.3・1.4節(行ごとに借方・貸方の向きを選べる形に一般化、
 * buildLineExpenseSplittingJournalEntryInput)。
 *
 * 検証に通らない入力は、精算バッチも仕訳も作らずにエラーを返す(バッチだけ作られて残るのを防ぐ)。
 * 分担相手(recipient)ごとに、選んだ行すべての分を1件の複合仕訳にまとめる。異なる相手の立替金・未払金の行を同じ仕訳に
 * 混ぜないのは、精算がタグごとの残高で行われ、別の相手の残高まで消し込んでしまうのを防ぐため。世帯外の相手を含む
 * 割勘では、精算バッチの取引先に先頭の相手を設定する。割勘仕訳は、選んだ行を持つ元の仕訳と同じ関連仕訳グループへ
 * 合流させ(joinOrCreateGroups)、元の行のidを割勘対象行の記録として仕訳に持たせる(割勘済みの判定に使う)。
 *
 * 均等・割合は、行ごとに行の金額を按分する(借方の行は正、貸方の行は負の負担額になる)。金額指定は、選んだ行の借方を正・
 * 貸方を負とした純額に対して、人ごとに入力した金額を行へ純額に対する割合で配分する(allocateSignedAcrossLines)。
 * 純額が0なら基準がなく、人ごとの合計が純額を超えるときも、書き込まずにエラーを返す。
 */
export async function submitExpenseSplit(params: SubmitExpenseSplitParams): Promise<SubmitExpenseSplitResult> {
  const { selectedLines, accounts, participants, allocationMode, memo, settlementBatchId, today, repositories } = params

  const advanceAssetAccountId = accounts.find((a) => a.category === 'asset' && a.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId = accounts.find((a) => a.category === 'liability' && a.isSystemManaged)?.id ?? null

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

  // 書き込みの前に、すべての分担相手の行ごとの負担額(符号付き)を計算して検証する
  const plan = planLineExpenseSplit({ selectedLines, accounts, participants, allocationMode })
  if (!plan.ok) return plan

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

  const originalEntryIds = [...new Set(selectedLines.map(({ entry }) => entry.id))]
  const createdEntries: JournalEntry[] = []
  for (const { row, signedShares } of plan.recipients) {
    const shares: LineExpenseSplitShare[] = selectedLines.map(({ entry, line }, i) => ({
      sourceLineId: line.id,
      accountId: line.accountId,
      projectId: line.projectId,
      signedAmount: signedShares[i],
      payerMemberId: entry.householdMemberId,
    }))
    const recipient: LineExpenseSplitRecipient =
      row.kind === 'householdMember'
        ? { kind: 'householdMember', toMemberId: row.targetId as number }
        : { kind: 'counterparty', counterpartyId: row.targetId as number }
    const input = buildLineExpenseSplittingJournalEntryInput({
      advanceAssetAccountId,
      advanceLiabilityAccountId,
      settlementBatchId: resolvedSettlementBatchId,
      entryDate: today,
      memo: memo.trim() === '' ? null : memo,
      recipient,
      shares,
    })
    const createdEntry = await repositories.journalEntryRepository.create({
      ...input,
      householdMemberId: selectedLines[0].entry.householdMemberId,
    })
    createdEntries.push(createdEntry)
    await repositories.journalEntryLinkGroupRepository.joinOrCreateGroups(originalEntryIds, [createdEntry.id])
  }
  return { ok: true, createdEntries }
}
