/**
 * calculateSettlementBalance(消込残高の計算)の純粋関数としてのユニットテスト。
 * docs/domain/settlement.md 1.6の「消込残高 = 元仕訳の一時勘定科目行の金額 -
 * Σ(journal_entry_links.amount WHERE link_type = 'settles' AND to_entry_id = 元仕訳.id)」を、
 * 分割消込(複数回のsettlesリンク)・過剰消込(マイナス残高)・無関係なリンクの除外を含めて検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { calculateSettlementBalance } from './calculateSettlementBalance'

const LIABILITY_ACCOUNT_ID = 10

function buildToEntry(temporaryLineAmount: number, id = 1): JournalEntry {
  return {
    id,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        id: 1,
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
        id: 2,
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

describe('calculateSettlementBalance', () => {
  it('settlesリンクが1件もない場合は一時勘定行の金額がそのまま残高になる', () => {
    const toEntry = buildToEntry(80000)

    const balance = calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, [])

    expect(balance).toBe(80000)
  })

  it('分割消込(1件のto_entryに対する複数のsettlesリンク)の合計を差し引いて残高を計算する', () => {
    const toEntry = buildToEntry(120000)
    const links = [
      buildSettlesLink(toEntry.id, 10000, 1),
      buildSettlesLink(toEntry.id, 10000, 2),
      buildSettlesLink(toEntry.id, 10000, 3),
    ]

    const balance = calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)

    expect(balance).toBe(90000)
  })

  it('消込残高が0になった時点で消込完了とみなせる', () => {
    const toEntry = buildToEntry(120000)
    const links = [buildSettlesLink(toEntry.id, 120000, 1)]

    const balance = calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)

    expect(balance).toBe(0)
  })

  it('過剰消込の場合は消込残高がマイナスになることを許容する', () => {
    const toEntry = buildToEntry(80000)
    const links = [buildSettlesLink(toEntry.id, 100000, 1)]

    const balance = calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)

    expect(balance).toBe(-20000)
  })

  it('他のto_entry宛のsettlesリンクやlinkType=allocatesのリンクは残高計算から除外する', () => {
    const toEntry = buildToEntry(80000)
    const links = [
      buildSettlesLink(999, 30000, 1),
      { id: 2, fromEntryId: 200, toEntryId: toEntry.id, linkType: 'allocates', amount: 5000, createdAt: '2026-01-02T00:00:00.000Z' } as JournalEntryLink,
    ]

    const balance = calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)

    expect(balance).toBe(80000)
  })
})
