import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { buildSettlementCloseEntries } from '../../domain/settlement-batch/buildSettlementCloseEntries'
import type { SettlementBatchSummary } from '../../domain/settlement-batch/summarizeSettlementBatch'
import type { MaybeAsync } from '../master/maybeAsync'

export interface CloseSettlementRepositories {
  journalEntryRepository: {
    create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
    delete(id: number): void | Promise<void>
  }
  journalEntryLinkGroupRepository: {
    joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void | Promise<void>
  }
  settlementBatchRepository: MaybeAsync<
    Pick<SettlementBatchRepository, 'deactivate' | 'activate' | 'recordCloseEntries' | 'findCloseEntryIds'>
  >
}

export interface CloseSettlementBatchParams {
  summary: SettlementBatchSummary
  accounts: readonly Account[]
  /** バッチに既にタグ付けされている仕訳のid(振替仕訳を関連仕訳グループへ合流させる起点) */
  taggedEntryIds: readonly number[]
  gainAccountId: number
  lossAccountId: number
  /** 振替仕訳の取引日(YYYY-MM-DD) */
  entryDate: string
  repositories: CloseSettlementRepositories
}

/**
 * 精算バッチをクローズする(計画Issue #249)。残高が残っていれば、残りを雑損失・雑収入へ振り替える仕訳を作り、
 * バッチに記録して(再オープンで削除するため)、バッチの既存の仕訳と同じ関連仕訳グループへ合流させる。
 * そのうえでバッチをクローズ済みにする。残高が0なら、仕訳は作らずクローズ済みにするだけ。
 * 複数の書き込みは、呼び出し側が操作履歴の1件にまとめる(runInHistoryGroup)。
 */
export async function closeSettlementBatch(params: CloseSettlementBatchParams): Promise<{ createdEntryIds: number[] }> {
  const { repositories, summary } = params
  const inputs = buildSettlementCloseEntries({
    summary,
    accounts: params.accounts,
    gainAccountId: params.gainAccountId,
    lossAccountId: params.lossAccountId,
    entryDate: params.entryDate,
    memo: `${summary.batch.name} クローズ(残高の振替)`,
  })

  const createdEntryIds: number[] = []
  for (const input of inputs) {
    createdEntryIds.push((await repositories.journalEntryRepository.create(input)).id)
  }
  if (createdEntryIds.length > 0) {
    await repositories.settlementBatchRepository.recordCloseEntries(summary.batch.id, createdEntryIds)
    await repositories.journalEntryLinkGroupRepository.joinOrCreateGroups(params.taggedEntryIds, createdEntryIds)
  }
  await repositories.settlementBatchRepository.deactivate(summary.batch.id)
  return { createdEntryIds }
}

export interface ReopenSettlementBatchParams {
  batchId: number
  repositories: Pick<CloseSettlementRepositories, 'settlementBatchRepository'> & {
    journalEntryRepository: Pick<CloseSettlementRepositories['journalEntryRepository'], 'delete'>
  }
}

/**
 * 精算バッチを再オープンする(計画Issue #249)。クローズのときに自動で作った振替仕訳(記録が残っているもの)を
 * 削除して残高を元に戻し、バッチを有効(未精算)に戻す。画面から既に消された振替仕訳は、記録ごと無くなっているので対象外。
 */
export async function reopenSettlementBatch(params: ReopenSettlementBatchParams): Promise<void> {
  const { repositories, batchId } = params
  for (const entryId of await repositories.settlementBatchRepository.findCloseEntryIds(batchId)) {
    await repositories.journalEntryRepository.delete(entryId)
  }
  await repositories.settlementBatchRepository.activate(batchId)
}
