/**
 * findUnallocatedEntries(割勘対象候補の絞り込み)の純粋関数としてのユニットテスト。
 * 既にallocatesリンク(to_entry_id側)を持つ仕訳を「割勘済み」とみなし、割勘対象の
 * 候補一覧から除外するルールを、src/domain/settlement/findUnsettledEntries.tsと対称的な
 * ケース(リンクなし・allocates済み・別のlinkTypeのみ・複数仕訳からの絞り込み)を含めて
 * 検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { findUnallocatedEntries } from './findUnallocatedEntries'

function buildEntry(id: number): JournalEntry {
  return {
    id,
    entryDate: '2026-06-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
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
    createdAt: '2026-06-02T00:00:00.000Z',
  }
}

describe('findUnallocatedEntries', () => {
  it('allocatesリンクが1件もない仕訳は未割勘として抽出する', () => {
    const entry = buildEntry(1)

    const result = findUnallocatedEntries([entry], new Map())

    expect(result).toEqual([entry])
  })

  it('既にallocatesリンク(to_entry側)を持つ仕訳(=割勘済み)は抽出しない', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const link = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const linksByEntryId = new Map([[originalEntry.id, [link]]])

    const result = findUnallocatedEntries([originalEntry], linksByEntryId)

    expect(result).toEqual([])
  })

  it('settlesリンクしか持たない仕訳(allocatesではない)は未割勘として抽出する', () => {
    const entry = buildEntry(1)
    const settlementEntry = buildEntry(2)
    const link = buildLink(1, settlementEntry.id, entry.id, 'settles')
    const linksByEntryId = new Map([[entry.id, [link]]])

    const result = findUnallocatedEntries([entry], linksByEntryId)

    expect(result).toEqual([entry])
  })

  it('複数の仕訳から未割勘のものだけを抽出する(26/6分は除外、26/7分は候補として残る)', () => {
    const alreadySplitJuneEntry = buildEntry(1)
    const candidateJulyEntry = buildEntry(2)
    const splitEntry = buildEntry(3)
    const link = buildLink(1, splitEntry.id, alreadySplitJuneEntry.id, 'allocates')
    const linksByEntryId = new Map([[alreadySplitJuneEntry.id, [link]]])

    const result = findUnallocatedEntries(
      [alreadySplitJuneEntry, candidateJulyEntry],
      linksByEntryId,
    )

    expect(result).toEqual([candidateJulyEntry])
  })
})
