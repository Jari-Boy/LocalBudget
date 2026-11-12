/**
 * filterJournalLinesByFinancialStatementFilterの純粋関数としてのユニットテスト。
 * FS画面(計画Issue #34)のプロジェクト別・世帯メンバー別・取引先別の複数選択絞り込み
 * (docs/domain/financial-statements.md 2.2節)を、仕訳明細レベルで実現する。
 * 各軸は複数選択(OR)、未指定の軸は絞り込まない、複数軸を同時指定した場合はAND、
 * 世帯メンバー軸は明細行のhouseholdMemberIdで判定する(科目の既定値・起票者は使わない、
 * 計画Issue #169)ことを中心に検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import { filterJournalLinesByFinancialStatementFilter } from './filterJournalLinesByFinancialStatementFilter'

function buildEntry(overrides: Partial<JournalEntry> & Pick<JournalEntry, 'lines'>): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-07-01',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 900,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function line(
  id: number,
  overrides: Partial<JournalEntry['lines'][number]> = {},
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId: 1,
    accountId: 1,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side: 'debit',
    amount: 1000,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('filterJournalLinesByFinancialStatementFilter', () => {
  it('フィルタを何も指定しなければ全明細をそのまま返す', () => {
    const entries = [buildEntry({ lines: [line(1, { projectId: 10 }), line(2, { projectId: 20 })] })]

    const result = filterJournalLinesByFinancialStatementFilter(entries, {})

    expect(result).toHaveLength(2)
  })

  it('projectIdsを指定すると、いずれかに一致する明細のみ返す(複数選択はOR)', () => {
    const entries = [
      buildEntry({
        lines: [line(1, { projectId: 10 }), line(2, { projectId: 20 }), line(3, { projectId: 30 })],
      }),
    ]

    const result = filterJournalLinesByFinancialStatementFilter(entries, { projectIds: [10, 20] })

    expect(result.map((l) => l.id)).toEqual([1, 2])
  })

  it('projectIdが未設定(null)の明細は、projectIdsフィルタ指定時には除外される', () => {
    const entries = [buildEntry({ lines: [line(1, { projectId: null }), line(2, { projectId: 10 })] })]

    const result = filterJournalLinesByFinancialStatementFilter(entries, { projectIds: [10] })

    expect(result.map((l) => l.id)).toEqual([2])
  })

  it('counterpartyIdsを指定すると、いずれかに一致する明細のみ返す', () => {
    const entries = [
      buildEntry({
        lines: [line(1, { counterpartyId: 1 }), line(2, { counterpartyId: 2 })],
      }),
    ]

    const result = filterJournalLinesByFinancialStatementFilter(entries, { counterpartyIds: [2] })

    expect(result.map((l) => l.id)).toEqual([2])
  })

  it('householdMemberIdsは明細行の世帯メンバーで判定する(科目の既定値や仕訳の起票者は使わない、計画Issue #169)', () => {
    const entries = [
      buildEntry({
        householdMemberId: 900,
        lines: [
          line(1, { accountId: 2, householdMemberId: 700 }),
          line(2, { accountId: 1, householdMemberId: 500 }),
        ],
      }),
    ]

    expect(filterJournalLinesByFinancialStatementFilter(entries, { householdMemberIds: [700] }).map((l) => l.id)).toEqual([1])
    expect(filterJournalLinesByFinancialStatementFilter(entries, { householdMemberIds: [900] })).toEqual([])
  })

  it('複数軸を同時に指定すると、両方に一致する明細のみ返す(軸間はAND)', () => {
    const entries = [
      buildEntry({
        lines: [
          line(1, { projectId: 10, counterpartyId: 1 }),
          line(2, { projectId: 10, counterpartyId: 2 }),
          line(3, { projectId: 20, counterpartyId: 1 }),
        ],
      }),
    ]

    const result = filterJournalLinesByFinancialStatementFilter(entries, {
      projectIds: [10],
      counterpartyIds: [1],
    })

    expect(result.map((l) => l.id)).toEqual([1])
  })
})
