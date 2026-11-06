/**
 * findUnassignedAdvanceEntriesForTarget(精算画面(計画Issue #139)の「消込む仕訳を選ぶ」候補一覧を
 * 組み立てる純粋関数)のユニットテスト。対象の科目でsettlement_batch_idが未設定(null)の明細行を
 * 候補とし、対象者が世帯メンバーの場合はhousehold_member_idが厳密に一致する行だけに絞る。対象者が
 * 取引先の場合はjournal_lines.counterparty_idを資産・負債の行に設定できない(docs/domain/
 * counterparties.md 1.2)ため、household_member_idがnullの行(特定の世帯メンバーに紐付いていない、
 * 外部との入出金とみなせる行)を候補とする(docs/domain/settlement.md、計画Issue #139の懸念点
 * 「候補仕訳の検索条件の具体的なクエリ実装は実装時に設計する」への対応)。DBアクセスなしの
 * 純粋関数。
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
    householdMemberId: null,
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

  it('取引先が対象者の場合、settlement_batch_id未設定かつhousehold_member_idがnullの行を候補にする', () => {
    const candidate = entry(1, '2026-10-05', [line({ id: 1, journalEntryId: 1, householdMemberId: null })])
    const memberOwned = entry(2, '2026-10-06', [line({ id: 2, journalEntryId: 2, householdMemberId: 300 })])

    const result = findUnassignedAdvanceEntriesForTarget([candidate, memberOwned], 10, {
      kind: 'counterparty',
      counterpartyId: 999,
    })

    expect(result).toEqual([{ entry: candidate, lineId: 1, amount: 1000 }])
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
