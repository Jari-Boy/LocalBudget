/**
 * buildConfirmedJournalEntryInput(レビュー確定後の仕訳組み立て、docs/domain/statement-import.md
 * 1.5 手順6-7)の純粋関数としてのユニットテスト。ImportedRecord+対象科目区分+相手科目等の
 * レビュー確定内容から、JournalEntryRepository.create()にそのまま渡せるCreateJournalEntryInput
 * (external_transaction_ref込み)を組み立てることを検証する。「amount正 = 対象科目残高が増える
 * 方向」であり、資産(asset)は借方増加・負債(liability)は貸方増加という科目区分による向きの
 * 反転(1.2の注記)を含む。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportedRecord } from './ImportedRecord'
import { buildConfirmedJournalEntryInput } from './buildConfirmedJournalEntryInput'

function record(overrides: Partial<ImportedRecord> = {}): ImportedRecord {
  return {
    entryDate: '2026-08-01',
    description: 'セブンイレブン 日本橋店',
    amount: -150,
    balanceAfter: 9850,
    externalId: null,
    isSettled: null,
    ...overrides,
  }
}

describe('資産科目(asset)の場合', () => {
  it('残高減少(amount負)の場合、対象科目は貸方・相手科目は借方になる', () => {
    const input = buildConfirmedJournalEntryInput({
      record: record({ amount: -150 }),
      externalId: 'HASH-001',
      targetAccountId: 1,
      targetAccountCategory: 'asset',
      counterAccountId: 2,
      entryHouseholdMemberId: 99,
    })

    expect(input.householdMemberId).toBe(99)
    expect(input.lines).toEqual([
      { accountId: 2, side: 'debit', amount: 150, counterpartyId: null, projectId: null, householdMemberId: null },
      { accountId: 1, side: 'credit', amount: 150 },
    ])
  })

  it('残高増加(amount正)の場合、対象科目は借方・相手科目は貸方になる', () => {
    const input = buildConfirmedJournalEntryInput({
      record: record({ amount: 250000, description: '給与振込' }),
      externalId: 'HASH-002',
      targetAccountId: 1,
      targetAccountCategory: 'asset',
      counterAccountId: 3,
      entryHouseholdMemberId: 99,
    })

    expect(input.lines).toEqual([
      { accountId: 1, side: 'debit', amount: 250000 },
      { accountId: 3, side: 'credit', amount: 250000, counterpartyId: null, projectId: null, householdMemberId: null },
    ])
  })
})

describe('負債科目(liability、クレジットカード未払金)の場合', () => {
  it('残高増加(amount正、利用額計上)の場合、対象科目は貸方・相手科目は借方になる', () => {
    const input = buildConfirmedJournalEntryInput({
      record: record({ amount: 3000, description: 'カード利用' }),
      externalId: 'HASH-003',
      targetAccountId: 1,
      targetAccountCategory: 'liability',
      counterAccountId: 4,
      entryHouseholdMemberId: 99,
    })

    expect(input.lines).toEqual([
      { accountId: 4, side: 'debit', amount: 3000, counterpartyId: null, projectId: null, householdMemberId: null },
      { accountId: 1, side: 'credit', amount: 3000 },
    ])
  })
})

describe('共通のヘッダー情報', () => {
  it('entryDate/memo/sourceType(external_import)を設定する', () => {
    const input = buildConfirmedJournalEntryInput({
      record: record({ entryDate: '2026-08-01', description: 'セブンイレブン' }),
      externalId: 'HASH-001',
      targetAccountId: 1,
      targetAccountCategory: 'asset',
      counterAccountId: 2,
      entryHouseholdMemberId: 99,
    })

    expect(input.entryDate).toBe('2026-08-01')
    expect(input.memo).toBe('セブンイレブン')
    expect(input.sourceType).toBe('external_import')
  })

  it('externalTransactionRefにImportedRecordのスナップショットと解決済みexternalIdを設定する', () => {
    const input = buildConfirmedJournalEntryInput({
      record: record({
        entryDate: '2026-08-01',
        description: 'セブンイレブン 日本橋店',
        amount: -150,
        balanceAfter: 9850,
        isSettled: true,
      }),
      externalId: 'HASH-001',
      targetAccountId: 1,
      targetAccountCategory: 'asset',
      counterAccountId: 2,
      entryHouseholdMemberId: 99,
    })

    expect(input.externalTransactionRef).toEqual({
      accountId: 1,
      externalId: 'HASH-001',
      entryDate: '2026-08-01',
      description: 'セブンイレブン 日本橋店',
      amount: -150,
      externalBalanceAfter: 9850,
      isSettled: true,
    })
  })

  it('相手科目行にcounterpartyId/projectId/householdMemberIdを設定できる', () => {
    const input = buildConfirmedJournalEntryInput({
      record: record({ amount: -150 }),
      externalId: 'HASH-001',
      targetAccountId: 1,
      targetAccountCategory: 'asset',
      counterAccountId: 2,
      counterpartyId: 10,
      projectId: 20,
      householdMemberId: 30,
      entryHouseholdMemberId: 99,
    })

    expect(input.lines[0]).toEqual({
      accountId: 2,
      side: 'debit',
      amount: 150,
      counterpartyId: 10,
      projectId: 20,
      householdMemberId: 30,
    })
  })
})
