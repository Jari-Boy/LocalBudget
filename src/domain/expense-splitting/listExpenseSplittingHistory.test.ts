/**
 * listExpenseSplittingHistory(全仕訳からの割勘履歴一覧の構築)の純粋関数としての
 * ユニットテスト。既存のtraceExpenseSplittingHistory(元仕訳→割勘仕訳→精算仕訳の
 * トラバーサル)を全仕訳候補に対して実行し、結果をsplitEntry(割勘仕訳)単位で
 * グルーピングし直すことで実現できることを検証する(docs/domain/expense-splitting.md
 * 1.5節「project_idでバッチ全体の仕訳を横断的に一覧することもできる」を踏まえた
 * 横断一覧)。1件の割勘仕訳が複数の元仕訳への一対多のallocatesリンクを持つ場合
 * (計画Issue #40「複数の元仕訳をまとめて一括割勘」)、同じ割勘仕訳が複数回検出されて
 * しまう点をグルーピングで1件に統合できることが本関数の主眼。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { listExpenseSplittingHistory } from './listExpenseSplittingHistory'

function buildEntry(id: number, entryDate = '2026-07-01'): JournalEntry {
  return {
    id,
    entryDate,
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    generatedFromRuleId: null,
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

describe('listExpenseSplittingHistory', () => {
  it('割勘仕訳が1件も存在しない場合、空配列を返す', () => {
    const originalEntry = buildEntry(1)

    const result = listExpenseSplittingHistory([originalEntry], new Map())

    expect(result).toEqual([])
  })

  it('単一の元仕訳から単一の割勘仕訳が作られた場合、1件の履歴エントリを返す', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const allocatesLink = buildLink(1, splitEntry.id, originalEntry.id, 'allocates')
    const linksByEntryId = new Map([[originalEntry.id, [allocatesLink]]])

    const result = listExpenseSplittingHistory([originalEntry, splitEntry], linksByEntryId)

    expect(result).toEqual([
      { splitEntry, originalEntries: [originalEntry], settlementEntries: [] },
    ])
  })

  it('複数の元仕訳をまとめて1回で割勘した場合、同じ割勘仕訳を1件の履歴エントリに統合しoriginalEntriesへ全元仕訳を含める', () => {
    const smartphoneEntry = buildEntry(1)
    const tabletEntry = buildEntry(2)
    const splitEntry = buildEntry(3)
    const allocatesLinkForSmartphone = buildLink(1, splitEntry.id, smartphoneEntry.id, 'allocates')
    const allocatesLinkForTablet = buildLink(2, splitEntry.id, tabletEntry.id, 'allocates')
    const linksByEntryId = new Map([
      [smartphoneEntry.id, [allocatesLinkForSmartphone]],
      [tabletEntry.id, [allocatesLinkForTablet]],
    ])

    const result = listExpenseSplittingHistory(
      [smartphoneEntry, tabletEntry, splitEntry],
      linksByEntryId,
    )

    expect(result).toHaveLength(1)
    expect(result[0].splitEntry).toEqual(splitEntry)
    expect(result[0].originalEntries).toEqual([smartphoneEntry, tabletEntry])
  })

  it('複数の元仕訳をまとめて1回で割勘した場合、originalEntriesはentries内の登場順ではなく取引日の昇順で並ぶ(Review Attempt 2指摘: findAll()の返り順=id順に依存しない)', () => {
    const laterEntry = buildEntry(1, '2026-07-10')
    const earlierEntry = buildEntry(2, '2026-07-05')
    const splitEntry = buildEntry(3)
    const linksByEntryId = new Map([
      [laterEntry.id, [buildLink(1, splitEntry.id, laterEntry.id, 'allocates')]],
      [earlierEntry.id, [buildLink(2, splitEntry.id, earlierEntry.id, 'allocates')]],
    ])

    // entries配列内の登場順はlaterEntryが先だが、取引日はearlierEntryの方が早い
    const result = listExpenseSplittingHistory([laterEntry, earlierEntry, splitEntry], linksByEntryId)

    expect(result).toHaveLength(1)
    expect(result[0].originalEntries.map((entry) => entry.id)).toEqual([earlierEntry.id, laterEntry.id])
  })

  it('複数件の独立した割勘がある場合、それぞれ別の履歴エントリとして返す', () => {
    const originalEntryA = buildEntry(1)
    const splitEntryA = buildEntry(2)
    const originalEntryB = buildEntry(3)
    const splitEntryB = buildEntry(4)
    const linksByEntryId = new Map([
      [originalEntryA.id, [buildLink(1, splitEntryA.id, originalEntryA.id, 'allocates')]],
      [originalEntryB.id, [buildLink(2, splitEntryB.id, originalEntryB.id, 'allocates')]],
    ])

    const result = listExpenseSplittingHistory(
      [originalEntryA, splitEntryA, originalEntryB, splitEntryB],
      linksByEntryId,
    )

    expect(result).toHaveLength(2)
    expect(result.map((item) => item.splitEntry.id).sort()).toEqual([splitEntryA.id, splitEntryB.id])
  })

  it('精算済みの割勘仕訳は、対応する精算仕訳をsettlementEntriesに含める', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const settlementEntry = buildEntry(3)
    const linksByEntryId = new Map([
      [originalEntry.id, [buildLink(1, splitEntry.id, originalEntry.id, 'allocates')]],
      [splitEntry.id, [buildLink(2, settlementEntry.id, splitEntry.id, 'settles')]],
    ])

    const result = listExpenseSplittingHistory(
      [originalEntry, splitEntry, settlementEntry],
      linksByEntryId,
    )

    expect(result).toEqual([
      { splitEntry, originalEntries: [originalEntry], settlementEntries: [settlementEntry] },
    ])
  })

  it('割勘仕訳自身は元仕訳(originalEntries)として結果に登場しない', () => {
    const originalEntry = buildEntry(1)
    const splitEntry = buildEntry(2)
    const linksByEntryId = new Map([
      [originalEntry.id, [buildLink(1, splitEntry.id, originalEntry.id, 'allocates')]],
    ])

    const result = listExpenseSplittingHistory([originalEntry, splitEntry], linksByEntryId)

    expect(result.some((item) => item.originalEntries.some((entry) => entry.id === splitEntry.id))).toBe(false)
  })
})
