/**
 * findUnsettledSettlementBatchesForTarget(精算画面(計画Issue #139)の「未精算の明細行
 * (バッチ単位の残高)」一覧を組み立てる純粋関数)のユニットテスト。対象者が世帯メンバーの場合は
 * counterparty_idがnullのバッチに限定し明細行のhousehold_member_idで厳密に一致させる。対象者が
 * 取引先の場合はsettlement_batches.counterparty_idでバッチを絞り込み、household_member_idに
 * よらずそのバッチ・科目の全明細行を合算する(advance行はcounterparty_idを持てないため、
 * docs/domain/counterparties.md 1.2)。DBアクセスなしの純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { findUnsettledSettlementBatchesForTarget } from './findUnsettledSettlementBatchesForTarget'

function line(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: 1,
    journalEntryId: 1,
    accountId: 10,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    side: 'credit',
    amount: 1000,
    createdAt: '2026-08-01',
    ...overrides,
  }
}

function batch(id: number, name: string, counterpartyId: number | null = null): SettlementBatch {
  return { id, name, type: 'expense_splitting', counterpartyId, createdAt: '2026-08-01', updatedAt: '2026-08-01' }
}

describe('findUnsettledSettlementBatchesForTarget', () => {
  it('世帯メンバーが対象者の場合、household_member_idが一致する行だけを合算し残高が0より大きいバッチを返す', () => {
    const batchA = batch(1, '6月生活費')
    const batchB = batch(2, '7月生活費')
    const lines = [
      line({ journalEntryId: 10, settlementBatchId: batchA.id, householdMemberId: 200, amount: 1500 }),
      line({ journalEntryId: 11, settlementBatchId: batchB.id, householdMemberId: 200, amount: 500, side: 'debit' }),
      line({ journalEntryId: 11, settlementBatchId: batchB.id, householdMemberId: 200, amount: 500 }),
    ]

    const result = findUnsettledSettlementBatchesForTarget(lines, [batchA, batchB], 10, 'liability', {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result).toEqual([{ batch: batchA, balance: 1500, taggedEntryIds: [10] }])
  })

  it('世帯メンバーが対象者の場合、counterparty_idを持つバッチ(取引先バッチ)は対象外にする', () => {
    const counterpartyBatch = batch(1, 'イオンの後払い分', 999)
    const lines = [
      line({ journalEntryId: 10, settlementBatchId: counterpartyBatch.id, householdMemberId: 200, amount: 1000 }),
    ]

    const result = findUnsettledSettlementBatchesForTarget(lines, [counterpartyBatch], 10, 'liability', {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result).toEqual([])
  })

  it('取引先が対象者の場合、counterparty_idが一致するバッチのhousehold_member_idを問わず全行を合算する', () => {
    const counterpartyBatch = batch(1, 'イオンの後払い分', 999)
    const lines = [
      line({ journalEntryId: 10, settlementBatchId: counterpartyBatch.id, householdMemberId: 100, amount: 4000 }),
      line({
        journalEntryId: 11,
        settlementBatchId: counterpartyBatch.id,
        householdMemberId: null,
        amount: 1000,
        side: 'debit',
      }),
    ]

    const result = findUnsettledSettlementBatchesForTarget(lines, [counterpartyBatch], 10, 'liability', {
      kind: 'counterparty',
      counterpartyId: 999,
    })

    expect(result).toEqual([{ batch: counterpartyBatch, balance: 3000, taggedEntryIds: [10, 11] }])
  })

  it('取引先が対象者の場合、counterparty_idが一致しないバッチは対象外にする', () => {
    const otherBatch = batch(1, '世帯内バッチ', null)
    const lines = [line({ journalEntryId: 10, settlementBatchId: otherBatch.id, amount: 1000 })]

    const result = findUnsettledSettlementBatchesForTarget(lines, [otherBatch], 10, 'liability', {
      kind: 'counterparty',
      counterpartyId: 999,
    })

    expect(result).toEqual([])
  })

  it('残高が0のバッチは結果から除外する', () => {
    const batchA = batch(1, '完済済みバッチ')
    const lines = [
      line({ journalEntryId: 10, settlementBatchId: batchA.id, householdMemberId: 200, amount: 1000 }),
      line({ journalEntryId: 11, settlementBatchId: batchA.id, householdMemberId: 200, amount: 1000, side: 'debit' }),
    ]

    const result = findUnsettledSettlementBatchesForTarget(lines, [batchA], 10, 'liability', {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result).toEqual([])
  })

  it('資産科目の場合は増加側(debit)を正として残高を計算する', () => {
    const batchA = batch(1, '立替金資産バッチ')
    const lines = [
      line({ journalEntryId: 10, settlementBatchId: batchA.id, householdMemberId: 200, amount: 800, side: 'debit' }),
    ]

    const result = findUnsettledSettlementBatchesForTarget(lines, [batchA], 10, 'asset', {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result).toEqual([{ batch: batchA, balance: 800, taggedEntryIds: [10] }])
  })
})
