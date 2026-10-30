/**
 * findLinkedLinesToRemove(仕訳の更新で削除される明細行のうち、リンクが付いているものの特定)の
 * 純粋関数としてのユニットテスト。計画Issue #132で、リンク付きの行を削除する編集は保存前に警告し、
 * 承認されたらリンクごと削除する(拒否はしない、docs/domain/settlement.md 1.8の「編集は妨げない」方針)
 * ため、画面が警告の要否と対象を判定するのに使う。リンクの向き(from_line・to_line)、割勘(allocates)・
 * 消込(settles)の別、削除されない行のリンクが対象外であること、行を残す更新では警告が出ないことを
 * 検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from './JournalEntry'
import type { JournalEntryLink } from './JournalEntryLink'
import { findLinkedLinesToRemove } from './findLinkedLinesToRemove'

function buildLine(id: number): JournalLine {
  return {
    id,
    journalEntryId: 1,
    accountId: 10,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side: 'debit',
    amount: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function buildEntry(lineIds: number[]): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    generatedFromRuleId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: lineIds.map(buildLine),
  }
}

function buildLink(id: number, fromLineId: number, toLineId: number, linkType: JournalEntryLink['linkType'] = 'settles'): JournalEntryLink {
  return {
    id,
    fromLineId,
    toLineId,
    fromEntryId: Math.floor(fromLineId / 10),
    toEntryId: Math.floor(toLineId / 10),
    linkType,
    amount: 500,
    createdAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('findLinkedLinesToRemove', () => {
  it('残す行のid集合に含まれない行のうち、to_lineとしてリンクが付いているものを返す', () => {
    const entry = buildEntry([1, 2, 3])
    const link = buildLink(1, 50, 2)

    const result = findLinkedLinesToRemove(entry, new Set([1, 3]), [link])

    expect(result).toEqual([{ line: entry.lines[1], links: [link] }])
  })

  it('from_lineとしてリンクが付いている行の削除も対象にする', () => {
    const entry = buildEntry([1, 2])
    const link = buildLink(1, 2, 80, 'allocates')

    const result = findLinkedLinesToRemove(entry, new Set([1]), [link])

    expect(result).toEqual([{ line: entry.lines[1], links: [link] }])
  })

  it('1つの行に複数のリンクがある場合は、その行にまとめて返す', () => {
    const entry = buildEntry([1, 2])
    const links = [buildLink(1, 50, 2), buildLink(2, 60, 2)]

    const result = findLinkedLinesToRemove(entry, new Set([1]), links)

    expect(result).toEqual([{ line: entry.lines[1], links }])
  })

  it('削除されない行に付いたリンクは対象にしない', () => {
    const entry = buildEntry([1, 2])
    const link = buildLink(1, 50, 1)

    expect(findLinkedLinesToRemove(entry, new Set([1]), [link])).toEqual([])
  })

  it('リンクが付いていない行を削除しても対象にならない', () => {
    const entry = buildEntry([1, 2])

    expect(findLinkedLinesToRemove(entry, new Set([1]), [])).toEqual([])
  })

  it('すべての行を残す更新(日付・メモ・金額の修正のみ)では何も返さない', () => {
    const entry = buildEntry([1, 2])
    const links = [buildLink(1, 50, 1), buildLink(2, 60, 2)]

    expect(findLinkedLinesToRemove(entry, new Set([1, 2]), links)).toEqual([])
  })

  it('この仕訳の行と無関係なリンクは無視する', () => {
    const entry = buildEntry([1, 2])
    const unrelated = buildLink(1, 50, 60)

    expect(findLinkedLinesToRemove(entry, new Set(), [unrelated])).toEqual([])
  })
})
