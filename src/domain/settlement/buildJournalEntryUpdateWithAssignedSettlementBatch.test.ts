/**
 * buildJournalEntryUpdateWithAssignedSettlementBatch(精算画面(計画Issue #139)で、選んだ候補仕訳の
 * 対象行にsettlement_batch_idを割り当てるUpdateJournalEntryInputを組み立てる純粋関数)の
 * ユニットテスト。指定した行だけにsettlementBatchIdを設定し、他の行はid以外そのまま保持する
 * (JournalEntryRepository.updateのidによる差分更新、docs/domain/journal.md参照)。DBアクセスなし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import { buildJournalEntryUpdateWithAssignedSettlementBatch } from './buildJournalEntryUpdateWithAssignedSettlementBatch'

function makeEntry(): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-10-05',
    memo: '配偶者からの立替金返済',
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-10-05',
    updatedAt: '2026-10-05',
    lines: [
      {
        id: 10,
        journalEntryId: 1,
        accountId: 20,
        projectId: null,
        householdMemberId: 200,
        counterpartyId: null,
        settlementBatchId: null,
        side: 'debit',
        amount: 1500,
        createdAt: '2026-10-05',
      },
      {
        id: 11,
        journalEntryId: 1,
        accountId: 30,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        settlementBatchId: null,
        side: 'credit',
        amount: 1500,
        createdAt: '2026-10-05',
      },
    ],
  }
}

describe('buildJournalEntryUpdateWithAssignedSettlementBatch', () => {
  it('指定した行にのみsettlementBatchIdを設定し、他の行は変更しない', () => {
    const entry = makeEntry()

    const result = buildJournalEntryUpdateWithAssignedSettlementBatch(entry, 10, 5)

    expect(result).toEqual({
      entryDate: '2026-10-05',
      memo: '配偶者からの立替金返済',
      lines: [
        {
          id: 10,
          accountId: 20,
          projectId: null,
          householdMemberId: 200,
          counterpartyId: null,
          settlementBatchId: 5,
          side: 'debit',
          amount: 1500,
        },
        {
          id: 11,
          accountId: 30,
          projectId: null,
          householdMemberId: null,
          counterpartyId: null,
          settlementBatchId: null,
          side: 'credit',
          amount: 1500,
        },
      ],
    })
  })
})
