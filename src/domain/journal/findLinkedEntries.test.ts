/**
 * findLinkedEntries(journal_entry_linksのlink_type非依存の汎用トラバーサル)の
 * 純粋関数としてのユニットテスト。docs/domain/journal.md 1.8の「ある仕訳の詳細画面から
 * to_entry_id = X AND link_type = Y で関連する仕訳を辿る」操作を、settles/allocatesの
 * いずれのlink_typeでも汎用的に行えることを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from './JournalEntry'
import type { JournalEntryLink } from './JournalEntryLink'
import { findLinkedEntries } from './findLinkedEntries'

function buildEntry(id: number): JournalEntry {
  return {
    id,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [],
  }
}

function buildLink(
  id: number,
  fromEntryId: number,
  toEntryId: number,
  linkType: JournalEntryLink['linkType'],
  amount = 500,
): JournalEntryLink {
  return {
    id,
    fromEntryId,
    toEntryId,
    linkType,
    amount,
    createdAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('findLinkedEntries', () => {
  it('toEntryを対象とするlinkTypeのリンクから、from_entry側の仕訳を辿って返す', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const link = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const linksByEntryId = new Map([[originalEntry.id, [link]]])

    const result = findLinkedEntries(
      originalEntry,
      'allocates',
      [originalEntry, splitEntry],
      linksByEntryId,
    )

    expect(result).toEqual([splitEntry])
  })

  it('指定したlinkTypeと異なるリンクは無視する', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const link = buildLink(1, splitEntry.id, originalEntry.id, 'settles')
    const linksByEntryId = new Map([[originalEntry.id, [link]]])

    const result = findLinkedEntries(
      originalEntry,
      'allocates',
      [originalEntry, splitEntry],
      linksByEntryId,
    )

    expect(result).toEqual([])
  })

  it('to_entry_idが対象の仕訳と一致しないリンクは無視する(from_entry側として登場するだけの場合)', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const settlementEntry = buildEntry(3)
    // splitEntryをfrom_entryとする別のsettlesリンクがlinksByEntryId上に混在していても、
    // originalEntryを対象にallocatesを辿る際には影響しない
    const allocatesLink = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const settlesLink = buildLink(2, settlementEntry.id, splitEntry.id, 'settles')
    const linksByEntryId = new Map([
      [originalEntry.id, [allocatesLink]],
      [splitEntry.id, [allocatesLink, settlesLink]],
    ])

    const result = findLinkedEntries(
      originalEntry,
      'allocates',
      [originalEntry, splitEntry, settlementEntry],
      linksByEntryId,
    )

    expect(result).toEqual([splitEntry])
  })

  it('リンクが1件もない場合は空配列を返す', () => {
    const originalEntry = buildEntry(1)

    const result = findLinkedEntries(originalEntry, 'allocates', [originalEntry], new Map())

    expect(result).toEqual([])
  })

  it('1件のto_entryに対して複数のfrom_entryが存在する場合(1対多)、すべて返す', () => {
    const originalEntry = buildEntry(1)
    const splitEntryA = buildEntry(2)
    const splitEntryB = buildEntry(3)
    const linkA = buildLink(1, splitEntryA.id, originalEntry.id, 'allocates')
    const linkB = buildLink(2, splitEntryB.id, originalEntry.id, 'allocates')
    const linksByEntryId = new Map([[originalEntry.id, [linkA, linkB]]])

    const result = findLinkedEntries(
      originalEntry,
      'allocates',
      [originalEntry, splitEntryA, splitEntryB],
      linksByEntryId,
    )

    expect(result).toEqual([splitEntryA, splitEntryB])
  })
})
