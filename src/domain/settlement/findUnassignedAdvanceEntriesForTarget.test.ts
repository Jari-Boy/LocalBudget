/**
 * findUnassignedAdvanceEntriesForTarget(精算画面(計画Issue #139)の「消込む仕訳を選ぶ」候補一覧を
 * 組み立てる純粋関数)のユニットテスト。対象の科目でsettlement_batch_idが未設定(null)の明細行を
 * 候補とし、対象者が世帯メンバーの場合はhousehold_member_idが厳密に一致する行だけに絞る。対象者が
 * 取引先の場合はjournal_lines.counterparty_idを資産・負債の行に設定できない(docs/domain/
 * counterparties.md 1.2)ため、household_member_idがnullの行(特定の世帯メンバーに紐付いていない、
 * 外部との入出金とみなせる行)を候補とする(docs/domain/settlement.md、計画Issue #139の懸念点
 * 「候補仕訳の検索条件の具体的なクエリ実装は実装時に設計する」への対応)。DBアクセスなしの
 * 純粋関数。計画Issue #145で、候補に検索条件(JournalEntryFilter)を重ねられるようにした。「立替金かつ
 * 対象者」を同じ行で満たす固定条件は検索条件では置き換えられないことも検証する。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { findUnassignedAdvanceEntriesForTarget } from './findUnassignedAdvanceEntriesForTarget'

function line(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: 1,
    journalEntryId: 1,
    accountId: 10,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side: 'debit',
    amount: 1000,
    createdAt: '2026-08-01',
    ...overrides,
  }
}

function entry(id: number, entryDate: string, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate,
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
    lines,
  }
}

describe('findUnassignedAdvanceEntriesForTarget', () => {
  it('世帯メンバーが対象者の場合、settlement_batch_id未設定かつhousehold_member_idが一致する行を候補にする', () => {
    const matching = entry(1, '2026-10-05', [line({ id: 1, journalEntryId: 1, householdMemberId: 200 })])
    const otherMember = entry(2, '2026-10-06', [line({ id: 2, journalEntryId: 2, householdMemberId: 300 })])
    const alreadyTagged = entry(3, '2026-10-07', [
      line({ id: 3, journalEntryId: 3, householdMemberId: 200, settlementBatchId: 1 }),
    ])

    const result = findUnassignedAdvanceEntriesForTarget([matching, otherMember, alreadyTagged], 10, {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result).toEqual([{ entry: matching, lineId: 1, amount: 1000 }])
  })

  it('対象科目と異なる科目の行は候補から除外する', () => {
    const other = entry(1, '2026-10-05', [line({ id: 1, journalEntryId: 1, accountId: 99, householdMemberId: 200 })])

    const result = findUnassignedAdvanceEntriesForTarget([other], 10, {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result).toEqual([])
  })

  it('取引日の昇順に並べ替えて返す', () => {
    const later = entry(1, '2026-10-20', [line({ id: 1, journalEntryId: 1, householdMemberId: 200, amount: 500 })])
    const earlier = entry(2, '2026-10-05', [line({ id: 2, journalEntryId: 2, householdMemberId: 200, amount: 1000 })])

    const result = findUnassignedAdvanceEntriesForTarget([later, earlier], 10, {
      kind: 'householdMember',
      householdMemberId: 200,
    })

    expect(result.map((candidate) => candidate.entry.id)).toEqual([2, 1])
  })
})

describe('findUnassignedAdvanceEntriesForTarget: 検索条件を重ねる(計画Issue #145)', () => {
  const target = { kind: 'householdMember', householdMemberId: 200 } as const
  const advance = 10

  it('立替金かつ対象者を同じ行で満たす固定条件は、別々の行で満たす仕訳を候補にしない', () => {
    // 立替金(10)の行は別のメンバー(300)、対象者(200)の行は別の科目(99)。別々の行では候補にならない
    const separateLines = entry(1, '2026-10-05', [
      line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 300 }),
      line({ id: 2, journalEntryId: 1, accountId: 99, householdMemberId: 200, side: 'credit' }),
    ])
    const sameLine = entry(2, '2026-10-06', [
      line({ id: 3, journalEntryId: 2, accountId: advance, householdMemberId: 200 }),
    ])

    const result = findUnassignedAdvanceEntriesForTarget([separateLines, sameLine], advance, target)

    expect(result.map((c) => c.entry.id)).toEqual([2])
  })

  it('検索条件を指定すると、固定条件を満たす行のうち検索条件にも合う仕訳だけを候補にする(AND)', () => {
    const lunch = {
      ...entry(1, '2026-10-05', [line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 200 })]),
      memo: '昼食',
    }
    const dinner = {
      ...entry(2, '2026-10-06', [line({ id: 2, journalEntryId: 2, accountId: advance, householdMemberId: 200 })]),
      memo: '夕食',
    }

    const result = findUnassignedAdvanceEntriesForTarget([lunch, dinner], advance, target, {
      filter: { memo: '昼' },
      accounts: [],
    })

    expect(result.map((c) => c.entry.id)).toEqual([1])
  })

  it('検索条件に合っても、固定条件(立替金かつ対象者の同じ行・未割当)を満たさない仕訳は候補にならない', () => {
    const tagged = {
      ...entry(1, '2026-10-05', [
        line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 200, settlementBatchId: 5 }),
      ]),
      memo: '昼食',
    }

    const result = findUnassignedAdvanceEntriesForTarget([tagged], advance, target, {
      filter: { memo: '昼' },
      accounts: [],
    })

    expect(result).toEqual([])
  })

  it('検索条件を指定しなければ従来どおりの候補を返す(既存の動作が変わらない)', () => {
    const candidate = entry(1, '2026-10-05', [line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 200 })])

    expect(findUnassignedAdvanceEntriesForTarget([candidate], advance, target)).toEqual([
      { entry: candidate, lineId: 1, amount: 1000 },
    ])
  })
})

describe('findUnassignedAdvanceEntriesForTarget: 方向(貸借)を固定条件にする(計画Issue #153)', () => {
  const target = { kind: 'householdMember', householdMemberId: 200 } as const
  const advance = 10

  it('side を指定すると、科目・方向・対象者を同じ行で満たす明細だけを候補にする', () => {
    // 立替金を減らす精算は立替金の貸方の行。借方(増える側)の行は候補にしない
    const decreasing = entry(1, '2026-10-05', [
      line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 200, side: 'credit' }),
    ])
    const increasing = entry(2, '2026-10-06', [
      line({ id: 2, journalEntryId: 2, accountId: advance, householdMemberId: 200, side: 'debit' }),
    ])

    const result = findUnassignedAdvanceEntriesForTarget([decreasing, increasing], advance, target, undefined, 'credit')

    expect(result.map((c) => c.entry.id)).toEqual([1])
  })

  it('別々の行で科目と方向を満たす仕訳は、side を指定しても候補にしない', () => {
    // 立替金の行は借方、貸方の行は別の科目。立替金の貸方の行を持たない
    const separate = entry(1, '2026-10-05', [
      line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 200, side: 'debit' }),
      line({ id: 2, journalEntryId: 1, accountId: 99, householdMemberId: 200, side: 'credit' }),
    ])

    expect(findUnassignedAdvanceEntriesForTarget([separate], advance, target, undefined, 'credit')).toEqual([])
  })

  it('side を省略すると方向では絞り込まない', () => {
    const both = entry(1, '2026-10-05', [
      line({ id: 1, journalEntryId: 1, accountId: advance, householdMemberId: 200, side: 'debit' }),
      line({ id: 2, journalEntryId: 1, accountId: advance, householdMemberId: 200, side: 'credit' }),
    ])

    expect(findUnassignedAdvanceEntriesForTarget([both], advance, target).map((c) => c.lineId)).toEqual([1, 2])
  })
})
