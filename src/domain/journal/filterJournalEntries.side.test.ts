/**
 * filterJournalEntries の「借方・貸方を分けた条件」(JournalEntryFilter.debit / credit)のユニットテスト(計画Issue #314)。
 * 科目・取引先・プロジェクト・世帯メンバー・精算バッチを、借方側の明細行・貸方側の明細行のどちらで満たすかを
 * 分けて指定できること、借方と貸方を両方指定したらAND、従来の「まとめて」の条件とも併用できること、
 * 複合仕訳では軸ごとに別々の明細行で満たしてよい(仕訳単位の判定、計画Issue #145の流儀)ことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from './JournalEntry'
import { filterJournalEntries } from './filterJournalEntries'

function buildAccount(id: number, accountGroupId: number | null = null): Account {
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
    accountGroupId,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

interface LineSpec {
  side: 'debit' | 'credit'
  accountId: number
  counterpartyId?: number | null
  projectId?: number | null
  householdMemberId?: number
  settlementBatchId?: number | null
  amount?: number
}

function buildEntry(id: number, lines: LineSpec[]): JournalEntry {
  return {
    id,
    entryDate: '2026-11-10',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lines: lines.map((line, index) => ({
      id: id * 10 + index,
      journalEntryId: id,
      accountId: line.accountId,
      projectId: line.projectId ?? null,
      householdMemberId: line.householdMemberId ?? 1,
      counterpartyId: line.counterpartyId ?? null,
      settlementBatchId: line.settlementBatchId ?? null,
      side: line.side,
      amount: line.amount ?? 1000,
      memo: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })),
  } as JournalEntry
}

/** 食費(10)を現金(20)で払った仕訳 / 現金(20)を預金(30)から引き出した仕訳 / 食費(10)をカード(40)で払った仕訳 */
const accounts = [buildAccount(10, 100), buildAccount(11, 100), buildAccount(20), buildAccount(30), buildAccount(40)]
const foodByCash = buildEntry(1, [
  { side: 'debit', accountId: 10 },
  { side: 'credit', accountId: 20 },
])
const withdraw = buildEntry(2, [
  { side: 'debit', accountId: 20 },
  { side: 'credit', accountId: 30 },
])
const foodByCard = buildEntry(3, [
  { side: 'debit', accountId: 10 },
  { side: 'credit', accountId: 40 },
])
const entries = [foodByCash, withdraw, foodByCard]
const idsOf = (list: readonly JournalEntry[]) => list.map((entry) => entry.id)

describe('filterJournalEntries(借方・貸方を分けた条件)', () => {
  it('借方の科目だけを指定すると、借方の明細行にその科目を持つ仕訳だけが残る(貸方側にある科目は対象外)', () => {
    const result = filterJournalEntries(entries, accounts, { debit: { accountIds: [20] } })

    expect(idsOf(result)).toEqual([2])
  })

  it('貸方の科目だけを指定すると、貸方の明細行にその科目を持つ仕訳だけが残る', () => {
    const result = filterJournalEntries(entries, accounts, { credit: { accountIds: [20] } })

    expect(idsOf(result)).toEqual([1])
  })

  it('従来のまとめての科目指定は、借方・貸方のどちらにあっても残す(従来どおり)', () => {
    const result = filterJournalEntries(entries, accounts, { accountIds: [20] })

    expect(idsOf(result)).toEqual([1, 2])
  })

  it('借方と貸方を両方指定すると、両方を満たす仕訳だけが残る(AND)', () => {
    const result = filterJournalEntries(entries, accounts, {
      debit: { accountIds: [10] },
      credit: { accountIds: [40] },
    })

    expect(idsOf(result)).toEqual([3])
  })

  it('借方の科目グループを指定すると、そのグループ配下の科目を借方に持つ仕訳が残る', () => {
    const result = filterJournalEntries(
      entries,
      accounts,
      { debit: { accountGroupIds: [100] } },
      { accountGroups: [{ id: 100, parentGroupId: null }] },
    )

    expect(idsOf(result)).toEqual([1, 3])
  })

  it('借方側の取引先を指定すると、借方の明細行にその取引先がある仕訳だけが残る(貸方側の取引先は対象外)', () => {
    const list = [
      buildEntry(1, [
        { side: 'debit', accountId: 10, counterpartyId: 7 },
        { side: 'credit', accountId: 20 },
      ]),
      buildEntry(2, [
        { side: 'debit', accountId: 10 },
        { side: 'credit', accountId: 20, counterpartyId: 7 },
      ]),
    ]

    expect(idsOf(filterJournalEntries(list, accounts, { debit: { counterpartyIds: [7] } }))).toEqual([1])
    expect(idsOf(filterJournalEntries(list, accounts, { credit: { counterpartyIds: [7] } }))).toEqual([2])
  })

  it('借方側のプロジェクト・世帯メンバーも、その側の明細行だけで判定する', () => {
    const list = [
      buildEntry(1, [
        { side: 'debit', accountId: 10, projectId: 5, householdMemberId: 2 },
        { side: 'credit', accountId: 20 },
      ]),
      buildEntry(2, [
        { side: 'debit', accountId: 10 },
        { side: 'credit', accountId: 20, projectId: 5, householdMemberId: 2 },
      ]),
    ]

    expect(idsOf(filterJournalEntries(list, accounts, { debit: { projectIds: [5] } }))).toEqual([1])
    expect(idsOf(filterJournalEntries(list, accounts, { credit: { projectIds: [5] } }))).toEqual([2])
    expect(idsOf(filterJournalEntries(list, accounts, { debit: { householdMemberIds: [2] } }))).toEqual([1])
    expect(idsOf(filterJournalEntries(list, accounts, { credit: { householdMemberIds: [2] } }))).toEqual([2])
  })

  it('借方側の精算バッチを指定すると、借方の明細行にそのバッチのタグがある仕訳だけが残る', () => {
    const list = [
      buildEntry(1, [
        { side: 'debit', accountId: 10, settlementBatchId: 9 },
        { side: 'credit', accountId: 20 },
      ]),
      buildEntry(2, [
        { side: 'debit', accountId: 10 },
        { side: 'credit', accountId: 20, settlementBatchId: 9 },
      ]),
    ]

    expect(idsOf(filterJournalEntries(list, accounts, { debit: { settlementBatchIds: [9] } }))).toEqual([1])
    expect(idsOf(filterJournalEntries(list, accounts, { credit: { settlementBatchIds: [9] } }))).toEqual([2])
  })

  it('複合仕訳では、借方の科目と借方の取引先を別々の借方の明細行で満たしてもヒットする(仕訳単位の判定)', () => {
    const compound = buildEntry(1, [
      { side: 'debit', accountId: 10 },
      { side: 'debit', accountId: 11, counterpartyId: 7 },
      { side: 'credit', accountId: 20 },
    ])

    const result = filterJournalEntries([compound], accounts, {
      debit: { accountIds: [10], counterpartyIds: [7] },
    })

    expect(idsOf(result)).toEqual([1])
  })

  it('借方・貸方の条件が空(キーが無い・空配列)のときは絞り込まない', () => {
    expect(idsOf(filterJournalEntries(entries, accounts, { debit: {}, credit: { accountIds: [] } }))).toEqual([1, 2, 3])
  })

  it('借方・貸方の条件は、期間・金額・摘要など他の条件ともANDで組み合わさる', () => {
    const result = filterJournalEntries(entries, accounts, {
      debit: { accountIds: [10] },
      dateFrom: '2026-12-01',
    })

    expect(result).toEqual([])
  })
})
