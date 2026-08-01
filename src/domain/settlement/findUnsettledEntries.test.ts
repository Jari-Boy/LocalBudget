/**
 * findUnsettledEntries(未消込エントリの判定)の純粋関数としてのユニットテスト。
 * docs/domain/settlement.md 1.6の「消込残高(calculateSettlementBalance)が0より大きい元仕訳を
 * 未消込として抽出する」ルールを、消込完了・未消込・リンク0件・過剰消込(マイナス残高は
 * 未消込に含めない)を含めて検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { findUnsettledEntries } from './findUnsettledEntries'

const LIABILITY_ACCOUNT_ID = 10

function buildToEntry(id: number, temporaryLineAmount: number): JournalEntry {
  return {
    id,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        id: id * 10 + 1,
        journalEntryId: id,
        accountId: 999,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        side: 'debit',
        amount: temporaryLineAmount,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: id * 10 + 2,
        journalEntryId: id,
        accountId: LIABILITY_ACCOUNT_ID,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        side: 'credit',
        amount: temporaryLineAmount,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

function buildSettlesLink(toEntryId: number, amount: number, id: number): JournalEntryLink {
  return {
    id,
    fromEntryId: 100 + id,
    toEntryId,
    linkType: 'settles',
    amount,
    createdAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('findUnsettledEntries', () => {
  it('settlesリンクが1件もない元仕訳は未消込として抽出する', () => {
    const entry = buildToEntry(1, 80000)

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, new Map())

    expect(result).toEqual([entry])
  })

  it('消込残高が0(消込完了)の元仕訳は抽出しない', () => {
    const entry = buildToEntry(1, 80000)
    const links = new Map([[entry.id, [buildSettlesLink(entry.id, 80000, 1)]]])

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([])
  })

  it('分割消込の途中(消込残高が0より大きい)の元仕訳は未消込として抽出する', () => {
    const entry = buildToEntry(1, 120000)
    const links = new Map([[entry.id, [buildSettlesLink(entry.id, 10000, 1)]]])

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([entry])
  })

  it('過剰消込(消込残高がマイナス)の元仕訳は未消込として抽出しない', () => {
    const entry = buildToEntry(1, 80000)
    const links = new Map([[entry.id, [buildSettlesLink(entry.id, 100000, 1)]]])

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([])
  })

  it('複数の元仕訳から未消込のものだけを抽出する', () => {
    const settledEntry = buildToEntry(1, 50000)
    const unsettledEntry = buildToEntry(2, 30000)
    const links = new Map([[settledEntry.id, [buildSettlesLink(settledEntry.id, 50000, 1)]]])

    const result = findUnsettledEntries([settledEntry, unsettledEntry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([unsettledEntry])
  })
})
