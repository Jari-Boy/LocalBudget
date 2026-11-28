/**
 * pinFilteredEntryIds / filterJournalEntriesWithPinned(絞り込み結果の固定、計画Issue #303)の純粋関数としてのユニットテスト。
 * 絞り込み条件を変えた時点の該当仕訳IDを保持し、そのあと編集で条件から外れても、条件を変えるまでは
 * 一覧に残す振る舞いを、期間・科目など複数の軸、削除、新規作成の観点で検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from './JournalEntry'
import { filterJournalEntriesWithPinned, pinFilteredEntryIds } from './pinFilteredEntries'

function buildAccount(id: number): Account {
  return {
    id,
    category: 'expense',
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function buildEntry(id: number, entryDate: string, accountId: number): JournalEntry {
  return {
    id,
    entryDate,
    memo: null,
    comment: null,
    householdMemberId: 1,
    sourceType: 'manual',
    lines: [
      { id: id * 10, side: 'debit', accountId, amount: 100, householdMemberId: 1, projectId: null },
      { id: id * 10 + 1, side: 'credit', accountId: 99, amount: 100, householdMemberId: 1, projectId: null },
    ],
  } as unknown as JournalEntry
}

const accounts = [buildAccount(1), buildAccount(2), buildAccount(99)]
const ids = (entries: JournalEntry[]) => entries.map((e) => e.id)

describe('pinFilteredEntryIds', () => {
  it('現在の条件に合う仕訳のIDだけを集合にして返す', () => {
    const entries = [buildEntry(1, '2026-08-01', 1), buildEntry(2, '2026-08-02', 2)]

    expect([...pinFilteredEntryIds(entries, accounts, { accountId: 1 }, {})]).toEqual([1])
  })
})

describe('filterJournalEntriesWithPinned', () => {
  it('固定が空なら、通常の絞り込みと同じ結果を返す', () => {
    const entries = [buildEntry(1, '2026-08-01', 1), buildEntry(2, '2026-08-02', 2)]

    expect(ids(filterJournalEntriesWithPinned(entries, accounts, { accountId: 1 }, {}, new Set()))).toEqual([1])
  })

  it('科目で絞り込み中に、仕訳の科目を変えて条件から外れても、固定した仕訳は残る', () => {
    const before = [buildEntry(1, '2026-08-01', 1), buildEntry(2, '2026-08-02', 1)]
    const pinned = pinFilteredEntryIds(before, accounts, { accountId: 1 }, {})
    const after = [buildEntry(1, '2026-08-01', 2), buildEntry(2, '2026-08-02', 1)]

    expect(ids(filterJournalEntriesWithPinned(after, accounts, { accountId: 1 }, {}, pinned))).toEqual([1, 2])
  })

  it('期間で絞り込み中に、日付を変えて条件から外れても、固定した仕訳は残る', () => {
    const filter = { dateFrom: '2026-08-01', dateTo: '2026-08-31' }
    const before = [buildEntry(1, '2026-08-10', 1)]
    const pinned = pinFilteredEntryIds(before, accounts, filter, {})
    const after = [buildEntry(1, '2026-09-10', 1)]

    expect(ids(filterJournalEntriesWithPinned(after, accounts, filter, {}, pinned))).toEqual([1])
  })

  it('条件を変えたときに固定を取り直せば、条件から外れた仕訳は消える', () => {
    const before = [buildEntry(1, '2026-08-01', 1)]
    const after = [buildEntry(1, '2026-08-01', 2)]
    const pinnedAgain = pinFilteredEntryIds(after, accounts, { accountId: 1 }, {})

    expect(ids(filterJournalEntriesWithPinned(after, accounts, { accountId: 1 }, {}, pinnedAgain))).toEqual([])
    expect(before).toHaveLength(1)
  })

  it('固定した仕訳が削除されて存在しなければ、一覧から消える', () => {
    const before = [buildEntry(1, '2026-08-01', 1), buildEntry(2, '2026-08-02', 1)]
    const pinned = pinFilteredEntryIds(before, accounts, { accountId: 1 }, {})

    expect(ids(filterJournalEntriesWithPinned([before[1]], accounts, { accountId: 1 }, {}, pinned))).toEqual([2])
  })

  it('固定のあとに作られた仕訳は、現在の条件に合うときだけ加わる', () => {
    const before = [buildEntry(1, '2026-08-01', 1)]
    const pinned = pinFilteredEntryIds(before, accounts, { accountId: 1 }, {})
    const after = [...before, buildEntry(3, '2026-08-03', 1), buildEntry(4, '2026-08-04', 2)]

    expect(ids(filterJournalEntriesWithPinned(after, accounts, { accountId: 1 }, {}, pinned))).toEqual([1, 3])
  })

  it('固定していない仕訳は、条件に合わなければ出ない(固定は元から該当した仕訳だけ)', () => {
    const before = [buildEntry(1, '2026-08-01', 1), buildEntry(2, '2026-08-02', 2)]
    const pinned = pinFilteredEntryIds(before, accounts, { accountId: 1 }, {})

    expect(ids(filterJournalEntriesWithPinned(before, accounts, { accountId: 1 }, {}, pinned))).toEqual([1])
  })
})
