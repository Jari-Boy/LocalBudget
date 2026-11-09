/**
 * splitSettleModel(割勘・精算画面の表示用の変換、計画Issue #153)のユニットテスト。
 * 分担相手の選択ツリー(世帯メンバーと取引先をグループつきで1つの木に並べる)の組み立てと、
 * 選んだ値(m:ID / c:ID)の読み書き、割勘履歴の状態・相手の表示用の組み立てを検証する。
 * DB・DOM非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { buildPartnerCategories, buildSplitHistoryRows, parsePartnerValue, toPartnerValue } from './splitSettleModel'

const counterpartyCategories: TreeSelectCategory[] = [
  {
    key: 'counterparty',
    name: 'すべての取引先',
    nodes: [
      {
        kind: 'group',
        id: '5',
        name: '友人',
        children: [{ kind: 'item', value: '9', name: '友人A', isActive: true }],
      },
      { kind: 'item', value: '10', name: 'イオン', isActive: true },
    ],
  },
]

describe('buildPartnerCategories', () => {
  it('世帯メンバーと世帯外(取引先)を区分に分け、グループの構造を保つ', () => {
    const categories = buildPartnerCategories(
      [
        { id: 1, name: '夫' },
        { id: 2, name: '妻' },
      ],
      counterpartyCategories,
    )

    expect(categories.map((c) => c.name)).toEqual(['世帯メンバー', '世帯外(取引先)'])
    expect(categories[0].nodes).toEqual([
      { kind: 'item', value: 'm:1', name: '夫', isActive: true },
      { kind: 'item', value: 'm:2', name: '妻', isActive: true },
    ])
    const group = categories[1].nodes[0]
    expect(group).toMatchObject({ kind: 'group', name: '友人' })
    expect(group.kind === 'group' && group.children[0]).toEqual({ kind: 'item', value: 'c:9', name: '友人A', isActive: true })
    expect(categories[1].nodes[1]).toEqual({ kind: 'item', value: 'c:10', name: 'イオン', isActive: true })
  })

  it('除外した世帯メンバー(立替者)は選択肢に出さない', () => {
    const categories = buildPartnerCategories(
      [
        { id: 1, name: '夫' },
        { id: 2, name: '妻' },
      ],
      counterpartyCategories,
      new Set([1]),
    )

    expect(categories[0].nodes.map((n) => n.kind === 'item' && n.name)).toEqual(['妻'])
  })
})

describe('parsePartnerValue / toPartnerValue', () => {
  it('m:ID は世帯メンバー、c:ID は世帯外の相手として読む', () => {
    expect(parsePartnerValue('m:2')).toEqual({ kind: 'householdMember', targetId: 2 })
    expect(parsePartnerValue('c:9')).toEqual({ kind: 'counterparty', targetId: 9 })
  })

  it('空文字や不正な値は未選択(targetId が null)として読む', () => {
    expect(parsePartnerValue('')).toEqual({ kind: 'householdMember', targetId: null })
    expect(parsePartnerValue('x:1')).toEqual({ kind: 'householdMember', targetId: null })
  })

  it('行の種類と相手から選択ツリーの値に戻せる', () => {
    expect(toPartnerValue({ kind: 'householdMember', targetId: 2 })).toBe('m:2')
    expect(toPartnerValue({ kind: 'counterparty', targetId: 9 })).toBe('c:9')
    expect(toPartnerValue({ kind: 'counterparty', targetId: null })).toBe('')
  })
})

describe('buildSplitHistoryRows', () => {
  const FOOD = 1
  const CASH = 2
  const ADVANCE_ASSET = 3
  const ADVANCE_LIABILITY = 4
  const accounts = [
    { id: FOOD, category: 'expense', name: '食費', isSystemManaged: false },
    { id: CASH, category: 'asset', name: '現金', isSystemManaged: false },
    { id: ADVANCE_ASSET, category: 'asset', name: '立替金', isSystemManaged: true },
    { id: ADVANCE_LIABILITY, category: 'liability', name: '未払金', isSystemManaged: true },
  ] as Account[]

  function line(
    id: number,
    entryId: number,
    accountId: number,
    side: 'debit' | 'credit',
    amount: number,
    overrides: Partial<JournalLine> = {},
  ): JournalLine {
    return {
      id,
      journalEntryId: entryId,
      accountId,
      projectId: null,
      householdMemberId: 1,
      counterpartyId: null,
      settlementBatchId: null,
      side,
      amount,
      createdAt: '',
      ...overrides,
    }
  }

  function entry(id: number, date: string, memo: string | null, sourceType: JournalEntry['sourceType'], lines: JournalLine[]): JournalEntry {
    return {
      id,
      entryDate: date,
      memo,
      comment: null,
      currency: 'JPY',
      sourceType,
      householdMemberId: 1,
      generatedFromRuleId: null,
      createdAt: '',
      updatedAt: '',
      lines,
    }
  }

  const original = entry(1, '2026-10-05', 'ランチ', 'manual', [line(11, 1, FOOD, 'debit', 1200), line(12, 1, CASH, 'credit', 1200)])
  const split = entry(2, '2026-10-31', 'ランチの割勘', 'expense_splitting', [
    line(21, 2, FOOD, 'debit', 600, { householdMemberId: 2 }),
    line(22, 2, ADVANCE_ASSET, 'debit', 600, { householdMemberId: 1, settlementBatchId: 7 }),
    line(23, 2, FOOD, 'credit', 600, { householdMemberId: 1 }),
    line(24, 2, ADVANCE_LIABILITY, 'credit', 600, { householdMemberId: 2, settlementBatchId: 7 }),
  ])
  const related = new Map([
    [1, new Set([2])],
    [2, new Set([1])],
  ])
  const members = [
    { id: 1, name: '夫' },
    { id: 2, name: '妻' },
  ]

  it('割勘仕訳ごとに、元の支出の日付、割勘仕訳の摘要、相手、相手の負担額を1行にする', () => {
    const rows = buildSplitHistoryRows([original, split], accounts, related, members, [])

    expect(rows).toEqual([
      expect.objectContaining({
        splitEntryId: 2,
        date: '2026-10-05',
        memo: 'ランチの割勘',
        partner: '妻',
        amount: 600,
        isSettled: false,
        canCancel: true,
      }),
    ])
  })

  it('立替金・未払金の残高がすべて0なら精算済みで、精算が進んだ割勘は取り消せない', () => {
    const settlement = entry(3, '2026-11-02', '精算', 'manual', [
      line(31, 3, CASH, 'debit', 600),
      line(32, 3, ADVANCE_ASSET, 'credit', 600, { householdMemberId: 1, settlementBatchId: 7 }),
      line(33, 3, ADVANCE_LIABILITY, 'debit', 600, { householdMemberId: 2, settlementBatchId: 7 }),
      line(34, 3, CASH, 'credit', 600),
    ])

    const [row] = buildSplitHistoryRows([original, split, settlement], accounts, related, members, [])

    expect(row).toMatchObject({ isSettled: true, canCancel: false })
  })

  it('割勘仕訳に摘要が無いときは、元の支出の摘要を使い、複数をまとめた割勘は件数で表す', () => {
    const noMemo = { ...split, memo: null }

    const [one] = buildSplitHistoryRows([original, noMemo], accounts, related, members, [])

    expect(one.memo).toBe('ランチ')
  })

  it('複数の元の支出をまとめた割勘は、日付を最も古い支出にする(摘要は割勘仕訳の摘要)', () => {
    const second = entry(4, '2026-10-06', null, 'manual', [line(41, 4, FOOD, 'debit', 800), line(42, 4, CASH, 'credit', 800)])
    const both = new Map([
      [1, new Set([2])],
      [4, new Set([2])],
      [2, new Set([1, 4])],
    ])

    const [row] = buildSplitHistoryRows([original, second, split], accounts, both, members, [])

    expect(row).toMatchObject({ date: '2026-10-05', memo: 'ランチの割勘' })

    const [noMemoRow] = buildSplitHistoryRows([original, second, { ...split, memo: '' }], accounts, both, members, [])
    expect(noMemoRow.memo).toBe('2件の支出')
  })
})
