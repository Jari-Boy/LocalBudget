/**
 * closeSettlementBatch / reopenSettlementBatch(精算バッチのクローズと再オープンの書き込み)のユニットテスト。
 * リポジトリは関数のモックで、書き込みの順序と内容を検証する。クローズは、残高が残っていれば振替仕訳を作って
 * バッチに記録し、関連仕訳グループへ合流させたうえでクローズ済みにする。残高が0なら仕訳を作らずクローズ済みにする。
 * 再オープンは、記録した振替仕訳を削除してからバッチを有効に戻す(計画Issue #249)。外部依存なし。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalLine } from '../../domain/journal/JournalEntry'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { summarizeSettlementBatch } from '../../domain/settlement-batch/summarizeSettlementBatch'
import { closeSettlementBatch, reopenSettlementBatch } from './closeSettlementBatch'

const BATCH_ID = 7
const ADVANCE_ID = 10
const PAYABLE_ID = 20

const batch: SettlementBatch = {
  id: BATCH_ID,
  name: '2026 年末旅行',
  type: 'expense_splitting',
  counterpartyId: null,
  isActive: true,
  createdAt: '',
  updatedAt: '',
}

const accounts = [
  { id: ADVANCE_ID, name: '未収金(精算バッチ)', category: 'asset', isReconcilable: false, isSystemManaged: true, householdMemberId: null },
  { id: PAYABLE_ID, name: '未払金(精算バッチ)', category: 'liability', isReconcilable: false, isSystemManaged: true, householdMemberId: null },
] as Account[]

let nextLineId = 1
const advanceLine = (side: 'debit' | 'credit', amount: number): JournalLine => ({
  id: nextLineId++,
  journalEntryId: 1,
  projectId: null,
  householdMemberId: 1,
  counterpartyId: null,
  settlementBatchId: BATCH_ID,
  accountId: ADVANCE_ID,
  side,
  amount,
  createdAt: '',
})

function makeRepositories() {
  const calls: string[] = []
  let nextEntryId = 900
  return {
    calls,
    repositories: {
      journalEntryRepository: {
        create: vi.fn(async () => {
          calls.push('create')
          return { id: nextEntryId++ } as never
        }),
        delete: vi.fn(async () => {
          calls.push('delete')
        }),
      },
      journalEntryLinkGroupRepository: {
        joinOrCreateGroups: vi.fn(async () => {
          calls.push('join')
        }),
      },
      settlementBatchRepository: {
        deactivate: vi.fn(async () => {
          calls.push('deactivate')
          return {} as never
        }),
        activate: vi.fn(async () => {
          calls.push('activate')
          return {} as never
        }),
        recordCloseEntries: vi.fn(async () => {
          calls.push('record')
        }),
        findCloseEntryIds: vi.fn(async () => [900, 901]),
      },
    },
  }
}

const closeParams = (lines: JournalLine[], repositories: ReturnType<typeof makeRepositories>['repositories']) => ({
  summary: summarizeSettlementBatch(batch, lines, accounts),
  accounts,
  taggedEntryIds: [1],
  gainAccountId: 40,
  lossAccountId: 41,
  entryDate: '2026-11-23',
  repositories,
})

describe('closeSettlementBatch', () => {
  it('残高が残っているときは、振替仕訳を作り、バッチに記録し、関連仕訳グループへ合流させてから、クローズ済みにする', async () => {
    const { calls, repositories } = makeRepositories()

    const result = await closeSettlementBatch(closeParams([advanceLine('debit', 6000)], repositories))

    expect(result.createdEntryIds).toEqual([900])
    expect(calls).toEqual(['create', 'record', 'join', 'deactivate'])
    expect(repositories.settlementBatchRepository.recordCloseEntries).toHaveBeenCalledWith(BATCH_ID, [900])
    expect(repositories.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1], [900])
  })

  it('作る仕訳は、残りの残高を雑損失へ振り替える内容で、摘要にバッチ名を含める', async () => {
    const { repositories } = makeRepositories()

    await closeSettlementBatch(closeParams([advanceLine('debit', 6000)], repositories))

    expect(repositories.journalEntryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryDate: '2026-11-23',
        memo: expect.stringContaining('2026 年末旅行'),
        lines: [
          expect.objectContaining({ accountId: 41, side: 'debit', amount: 6000 }),
          expect.objectContaining({ accountId: ADVANCE_ID, side: 'credit', amount: 6000, settlementBatchId: BATCH_ID }),
        ],
      }),
    )
  })

  it('残高が0のときは、仕訳を作らず、クローズ済みにするだけ', async () => {
    const { calls, repositories } = makeRepositories()

    const result = await closeSettlementBatch(closeParams([advanceLine('debit', 100), advanceLine('credit', 100)], repositories))

    expect(result.createdEntryIds).toEqual([])
    expect(calls).toEqual(['deactivate'])
  })
})

describe('reopenSettlementBatch', () => {
  it('記録した振替仕訳をすべて削除してから、バッチを有効に戻す', async () => {
    const { calls, repositories } = makeRepositories()

    await reopenSettlementBatch({ batchId: BATCH_ID, repositories })

    expect(repositories.journalEntryRepository.delete).toHaveBeenCalledWith(900)
    expect(repositories.journalEntryRepository.delete).toHaveBeenCalledWith(901)
    expect(calls).toEqual(['delete', 'delete', 'activate'])
  })

  it('記録した振替仕訳が無い(残高0でクローズした)ときは、バッチを有効に戻すだけ', async () => {
    const { calls, repositories } = makeRepositories()
    repositories.settlementBatchRepository.findCloseEntryIds.mockResolvedValueOnce([])

    await reopenSettlementBatch({ batchId: BATCH_ID, repositories })

    expect(calls).toEqual(['activate'])
  })
})
