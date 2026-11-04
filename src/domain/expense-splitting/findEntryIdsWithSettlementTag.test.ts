/**
 * findEntryIdsWithSettlementTag(settlement_batch_id等のタグが一致する明細行を持つ仕訳idの抽出)の
 * 純粋関数としてのユニットテスト。精算仕訳作成時に、どの割勘仕訳(または既存の精算仕訳)を
 * 関連仕訳グループへ結びつけるべきかを特定するための補助関数であることを検証する(計画Issue #138)。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
import { findEntryIdsWithSettlementTag } from './findEntryIdsWithSettlementTag'

function line(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: 0,
    journalEntryId: 0,
    accountId: 1,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    side: 'debit',
    amount: 500,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('findEntryIdsWithSettlementTag', () => {
  it('タグ(settlementBatchId・accountId・householdMemberId・counterpartyId)が一致する行の仕訳idを返す', () => {
    const lines = [
      line({ id: 1, journalEntryId: 10, settlementBatchId: 5, accountId: 2, householdMemberId: 100 }),
      line({ id: 2, journalEntryId: 20, settlementBatchId: 5, accountId: 2, householdMemberId: 200 }),
    ]

    const result = findEntryIdsWithSettlementTag(lines, {
      settlementBatchId: 5,
      accountId: 2,
      householdMemberId: 100,
      counterpartyId: null,
    })

    expect(result).toEqual([10])
  })

  it('同一仕訳が複数の一致行を持っていても仕訳idは1回だけ返す', () => {
    const lines = [
      line({ id: 1, journalEntryId: 10, settlementBatchId: 5, accountId: 2, householdMemberId: 100 }),
      line({ id: 2, journalEntryId: 10, settlementBatchId: 5, accountId: 2, householdMemberId: 100 }),
    ]

    const result = findEntryIdsWithSettlementTag(lines, {
      settlementBatchId: 5,
      accountId: 2,
      householdMemberId: 100,
      counterpartyId: null,
    })

    expect(result).toEqual([10])
  })

  it('タグが一致しない行は含めない', () => {
    const lines = [
      line({ id: 1, journalEntryId: 10, settlementBatchId: 5, accountId: 2, householdMemberId: 100 }),
      line({ id: 2, journalEntryId: 20, settlementBatchId: 6, accountId: 2, householdMemberId: 100 }),
      line({ id: 3, journalEntryId: 30, settlementBatchId: 5, accountId: 3, householdMemberId: 100 }),
      line({ id: 4, journalEntryId: 40, settlementBatchId: 5, accountId: 2, householdMemberId: 999 }),
    ]

    const result = findEntryIdsWithSettlementTag(lines, {
      settlementBatchId: 5,
      accountId: 2,
      householdMemberId: 100,
      counterpartyId: null,
    })

    expect(result).toEqual([10])
  })

  it('counterpartyIdでのタグ一致にも対応する(世帯外相手との割勘)', () => {
    const lines = [
      line({ id: 1, journalEntryId: 10, settlementBatchId: 5, accountId: 2, counterpartyId: 300 }),
      line({ id: 2, journalEntryId: 20, settlementBatchId: 5, accountId: 2, counterpartyId: 301 }),
    ]

    const result = findEntryIdsWithSettlementTag(lines, {
      settlementBatchId: 5,
      accountId: 2,
      householdMemberId: null,
      counterpartyId: 300,
    })

    expect(result).toEqual([10])
  })

  it('一致する行が無い場合は空配列を返す', () => {
    const result = findEntryIdsWithSettlementTag([], {
      settlementBatchId: 5,
      accountId: 2,
      householdMemberId: 100,
      counterpartyId: null,
    })

    expect(result).toEqual([])
  })
})
