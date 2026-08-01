/**
 * traceExpenseSplittingHistory(元仕訳→割勘仕訳→精算仕訳のトラバーサル)の
 * 純粋関数としてのユニットテスト。docs/domain/expense-splitting.md 1.5節の
 * 「元仕訳の詳細画面からallocatesリンクで割勘仕訳を辿り、さらにsettlesリンクで精算仕訳を
 * 辿る」流れを、journal/findLinkedEntriesを2回(allocates→settles)合成することで
 * 実現できることを、精算前・精算後・複数の割勘バッチ(1対多)を含めて検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { traceExpenseSplittingHistory } from './traceExpenseSplittingHistory'

function buildEntry(id: number): JournalEntry {
  return {
    id,
    entryDate: '2026-07-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines: [],
  }
}

function buildLink(
  id: number,
  fromEntryId: number,
  toEntryId: number,
  linkType: JournalEntryLink['linkType'],
): JournalEntryLink {
  return {
    id,
    fromEntryId,
    toEntryId,
    linkType,
    amount: 500,
    createdAt: '2026-07-02T00:00:00.000Z',
  }
}

describe('traceExpenseSplittingHistory', () => {
  it('精算前(割勘仕訳のみ)の場合、割勘仕訳を1件・精算仕訳を0件で辿る', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const allocatesLink = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const linksByEntryId = new Map([[originalEntry.id, [allocatesLink]]])

    const result = traceExpenseSplittingHistory(
      originalEntry,
      [originalEntry, splitEntry],
      linksByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [] }])
  })

  it('精算後(割勘仕訳+精算仕訳)の場合、元仕訳→割勘仕訳→精算仕訳の一連の流れを辿る', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const settlementEntry = buildEntry(3)
    const allocatesLink = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const settlesLink = buildLink(2, settlementEntry.id, splitEntry.id, 'settles')
    const linksByEntryId = new Map([
      [originalEntry.id, [allocatesLink]],
      [splitEntry.id, [settlesLink]],
    ])

    const result = traceExpenseSplittingHistory(
      originalEntry,
      [originalEntry, splitEntry, settlementEntry],
      linksByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [settlementEntry] }])
  })

  it('複数の精算(分割消込)がある場合、すべての精算仕訳を返す', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const settlementEntry1 = buildEntry(3)
    const settlementEntry2 = buildEntry(4)
    const allocatesLink = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const settlesLink1 = buildLink(2, settlementEntry1.id, splitEntry.id, 'settles')
    const settlesLink2 = buildLink(3, settlementEntry2.id, splitEntry.id, 'settles')
    const linksByEntryId = new Map([
      [originalEntry.id, [allocatesLink]],
      [splitEntry.id, [settlesLink1, settlesLink2]],
    ])

    const result = traceExpenseSplittingHistory(
      originalEntry,
      [originalEntry, splitEntry, settlementEntry1, settlementEntry2],
      linksByEntryId,
    )

    expect(result).toEqual([
      { splitEntry, settlementEntries: [settlementEntry1, settlementEntry2] },
    ])
  })

  it('割勘仕訳がまだ1件もない元仕訳は空配列を返す', () => {
    const originalEntry = buildEntry(1)

    const result = traceExpenseSplittingHistory(originalEntry, [originalEntry], new Map())

    expect(result).toEqual([])
  })

  it('1回の割勘バッチが複数の元仕訳をまとめて対象にする場合、対応する割勘仕訳だけを辿る(from_entry_id側のあいまいさがないこと)', () => {
    const smartphoneEntry = buildEntry(1)
    const tabletEntry = buildEntry(2)
    const splitEntry = buildEntry(3)
    const allocatesLinkForSmartphone = buildLink(1, splitEntry.id, smartphoneEntry.id, 'allocates')
    const allocatesLinkForTablet = buildLink(2, splitEntry.id, tabletEntry.id, 'allocates')
    const linksByEntryId = new Map([
      [smartphoneEntry.id, [allocatesLinkForSmartphone]],
      [tabletEntry.id, [allocatesLinkForTablet]],
    ])

    const result = traceExpenseSplittingHistory(
      smartphoneEntry,
      [smartphoneEntry, tabletEntry, splitEntry],
      linksByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [] }])
  })
})
