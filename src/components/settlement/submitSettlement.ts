import type { CreateJournalEntryInput, JournalEntry, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import type { SettlementDirection } from '../../domain/settlement-batch/summarizeSettlementBatch'
import type { SettlementTarget } from '../../domain/settlement-batch/SettlementTarget'
import type { UnassignedAdvanceEntryCandidate } from '../../domain/settlement/findUnassignedAdvanceEntriesForTarget'
import { buildJournalEntryUpdateWithAssignedSettlementBatch } from '../../domain/settlement/buildJournalEntryUpdateWithAssignedSettlementBatch'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
import { resolveSettlementAdjustment } from '../../domain/settlement/resolveSettlementAdjustment'

export interface SettlementRepositories {
  journalEntryRepository: {
    update(id: number, input: UpdateJournalEntryInput): JournalEntry | Promise<JournalEntry>
    create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
  }
  journalEntryLinkGroupRepository: {
    joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void | Promise<void>
  }
}

interface CommonParams {
  batchId: number
  /** バッチに既にタグ付けされている仕訳のid(関連仕訳グループへ合流する起点) */
  taggedEntryIds: readonly number[]
  direction: SettlementDirection
  /** 立替金または未払金の科目id */
  accountId: number
  target: SettlementTarget
  /** 仕訳の起票者 */
  entryHouseholdMemberId: number
  repositories: SettlementRepositories
}

const categoryOf = (direction: SettlementDirection) => (direction === 'advance' ? 'asset' : 'liability')
const memberIdOf = (target: SettlementTarget) => (target.kind === 'householdMember' ? target.householdMemberId : null)

export interface TagCandidatesParams extends CommonParams {
  candidates: readonly UnassignedAdvanceEntryCandidate[]
  /** 選んだ仕訳の合計 − 方向の残高 */
  diff: number
  /** trueなら差額を雑収入・雑損失に計上してバッチの残高を0にする。falseならタグを付けるだけ */
  createAdjustment: boolean
  adjustmentAccountIds: { gain: number; loss: number }
  /** 調整仕訳の取引日(YYYY-MM-DD) */
  today: string
}

/**
 * 選んだ未割当の仕訳の対象行にバッチのタグを付ける(新規の仕訳は作らない)。createAdjustmentなら、
 * 差額を雑収入・雑損失へ計上する調整仕訳も追加する(向きはresolveSettlementAdjustmentが決める)。
 * タグを付けた仕訳と調整仕訳は、バッチの既存の仕訳と同じ関連仕訳グループへ合流させる。
 * 旧精算画面のhandleAssignSelectedを画面から切り出したもの(計画Issue #153、docs/domain/settlement.md 1.9)。
 */
export async function tagCandidatesToBatch(params: TagCandidatesParams): Promise<void> {
  const { repositories, batchId, candidates } = params
  const newEntryIds: number[] = []
  for (const candidate of candidates) {
    await repositories.journalEntryRepository.update(
      candidate.entry.id,
      buildJournalEntryUpdateWithAssignedSettlementBatch(candidate.entry, candidate.lineId, batchId),
    )
    newEntryIds.push(candidate.entry.id)
  }

  if (params.createAdjustment && params.diff !== 0) {
    const adjustment = resolveSettlementAdjustment(params.diff, categoryOf(params.direction))
    const created = await repositories.journalEntryRepository.create(
      buildSettlementJournalEntryInput({
        settlementBatchId: batchId,
        settlementAccountId: params.accountId,
        settlementAccountCategory: adjustment.effectiveCategory,
        counterAccountId: adjustment.isGain ? params.adjustmentAccountIds.gain : params.adjustmentAccountIds.loss,
        amount: adjustment.amount,
        settlementHouseholdMemberId: memberIdOf(params.target),
        entryHouseholdMemberId: params.entryHouseholdMemberId,
        entryDate: params.today,
      }),
    )
    newEntryIds.push(created.id)
  }

  if (newEntryIds.length > 0) {
    await repositories.journalEntryLinkGroupRepository.joinOrCreateGroups(params.taggedEntryIds, newEntryIds)
  }
}

export interface CreateSettlementEntryParams extends CommonParams {
  /** 口座など、実際の入出金があった相手科目 */
  counterAccountId: number
  amount: number
  entryDate: string
  memo: string | null
}

/**
 * 精算の仕訳を新規に起票してバッチに紐づける(現金でのやり取りなど、候補の仕訳が無い場合。計画Issue #153で
 * 候補の有無によらず常に起票できるようにした)。バッチの既存の仕訳と同じ関連仕訳グループへ合流させる。
 */
export async function createSettlementEntry(params: CreateSettlementEntryParams): Promise<JournalEntry> {
  const created = await params.repositories.journalEntryRepository.create(
    buildSettlementJournalEntryInput({
      settlementBatchId: params.batchId,
      settlementAccountId: params.accountId,
      settlementAccountCategory: categoryOf(params.direction),
      counterAccountId: params.counterAccountId,
      amount: params.amount,
      settlementHouseholdMemberId: memberIdOf(params.target),
      entryHouseholdMemberId: params.entryHouseholdMemberId,
      entryDate: params.entryDate,
      memo: params.memo,
    }),
  )
  await params.repositories.journalEntryLinkGroupRepository.joinOrCreateGroups(params.taggedEntryIds, [created.id])
  return created
}
