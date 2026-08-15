/**
 * filterJournalEntries(仕訳の複数軸絞り込み)の純粋関数としてのユニットテスト。
 * 期間(dateFrom/dateTo)・科目(accountId)・世帯メンバー(householdMemberId、実効メンバー
 * 解決込み)・プロジェクト(projectId)の4軸をAND条件で組み合わせて仕訳を絞り込む
 * ロジックを検証する(計画Issue #40、割勘対象選択画面での再利用を見据えた共通フィルタ)。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from './JournalEntry'
import { filterJournalEntries } from './filterJournalEntries'

function buildAccount(id: number, overrides?: Partial<Account>): Account {
  return {
    id,
    category: 'expense',
    name: `科目${id}`,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntry(overrides: {
  id: number
  entryDate: string
  householdMemberId?: number
  lines?: { accountId: number; projectId?: number | null; householdMemberId?: number | null }[]
}): JournalEntry {
  return {
    id: overrides.id,
    entryDate: overrides.entryDate,
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: overrides.householdMemberId ?? 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lines: (overrides.lines ?? [{ accountId: 10 }]).map((line, index) => ({
      id: overrides.id * 10 + index,
      journalEntryId: overrides.id,
      accountId: line.accountId,
      projectId: line.projectId ?? null,
      householdMemberId: line.householdMemberId ?? null,
      counterpartyId: null,
      side: 'debit' as const,
      amount: 1000,
      createdAt: '2026-08-01T00:00:00.000Z',
    })),
  }
}

describe('filterJournalEntries', () => {
  it('フィルタ条件を何も指定しない場合、全件を返す', () => {
    const entries = [buildEntry({ id: 1, entryDate: '2026-08-01' }), buildEntry({ id: 2, entryDate: '2026-08-02' })]

    const result = filterJournalEntries(entries, [], {})

    expect(result).toEqual(entries)
  })

  it('dateFromで、指定日より前の仕訳を除外する', () => {
    const entries = [buildEntry({ id: 1, entryDate: '2026-07-31' }), buildEntry({ id: 2, entryDate: '2026-08-01' })]

    const result = filterJournalEntries(entries, [], { dateFrom: '2026-08-01' })

    expect(result.map((e) => e.id)).toEqual([2])
  })

  it('dateToで、指定日より後の仕訳を除外する', () => {
    const entries = [buildEntry({ id: 1, entryDate: '2026-08-01' }), buildEntry({ id: 2, entryDate: '2026-08-02' })]

    const result = filterJournalEntries(entries, [], { dateTo: '2026-08-01' })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('accountIdで、いずれの明細行にも一致する科目を含まない仕訳を除外する', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 20 }] }),
    ]

    const result = filterJournalEntries(entries, [], { accountId: 10 })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('projectIdで、いずれの明細行にも一致するプロジェクトを含まない仕訳を除外する', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 5 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 6 }] }),
    ]

    const result = filterJournalEntries(entries, [], { projectId: 5 })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('householdMemberIdで、実効メンバー(科目既定値優先・無ければ明細→起票者の順)が一致しない仕訳を除外する', () => {
    const accounts = [buildAccount(10, { householdMemberId: 100 }), buildAccount(20)]
    const entries = [
      // 科目10には既定メンバー100が設定されているため、明細のhouseholdMemberIdは無視される
      buildEntry({
        id: 1,
        entryDate: '2026-08-01',
        householdMemberId: 999,
        lines: [{ accountId: 10, householdMemberId: 200 }],
      }),
      // 科目20には既定値が無いため、明細のhouseholdMemberId(300)が使われる
      buildEntry({
        id: 2,
        entryDate: '2026-08-01',
        householdMemberId: 999,
        lines: [{ accountId: 20, householdMemberId: 300 }],
      }),
    ]

    const result = filterJournalEntries(entries, accounts, { householdMemberId: 100 })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('複数軸を同時に指定した場合、AND条件で絞り込む', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 5 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 6 }] }),
      buildEntry({ id: 3, entryDate: '2026-07-01', lines: [{ accountId: 10, projectId: 5 }] }),
    ]

    const result = filterJournalEntries(entries, [], { accountId: 10, projectId: 5, dateFrom: '2026-08-01' })

    expect(result.map((e) => e.id)).toEqual([1])
  })
})
