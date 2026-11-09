/**
 * buildMonthlySummaries(分析画面のグラフ・月次表の元データ、計画Issue #155)のユニットテスト。
 * 月ごとの収益・費用・収支・月末の純資産と、費用の最上位グループ別の合計を求める。
 * - 月末の純資産は、財務諸表(BS)の純資産合計と同じ式(初期残高+損益の累計)
 * - 費用のグループ別合計は、上位5グループ+「その他」(グループ外・6番目以降)に振り分け、合計は費用と一致する
 * 世帯メンバー等の絞り込みも各月に適用されることを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account, AccountCategory } from '../account/Account'
import type { AccountGroup } from '../account-group/AccountGroup'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { buildMonthlySummaries, resolveTopExpenseGroups } from './buildMonthlySummaries'

function account(id: number, category: AccountCategory, name: string, accountGroupId: number | null = null): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
  }
}

function group(id: number, name: string, parentGroupId: number | null, sortOrder = id): AccountGroup {
  return { id, name, parentGroupId, category: 'expense', sortOrder, isActive: true, createdAt: '', updatedAt: '' }
}

const groups: AccountGroup[] = [group(10, '生活', null), group(11, '食', 10), group(12, '趣味', null)]

const accounts: Account[] = [
  account(1, 'asset', '現金'),
  account(2, 'expense', '食費', 11),
  account(3, 'revenue', '給与'),
  account(4, 'equity', '初期残高'),
  account(5, 'expense', '映画', 12),
  account(6, 'expense', '社会保険料'),
]

function entry(id: number, entryDate: string, lines: [number, 'debit' | 'credit', number][], householdMemberId = 1): JournalEntry {
  return {
    id,
    entryDate,
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId,
    generatedFromRuleId: null,
    createdAt: '',
    updatedAt: '',
    lines: lines.map(
      ([accountId, side, amount], i): JournalLine => ({
        id: id * 10 + i,
        journalEntryId: id,
        accountId,
        projectId: null,
        householdMemberId,
        counterpartyId: null,
        settlementBatchId: null,
        side,
        amount,
        createdAt: '',
      }),
    ),
  }
}

const entries: JournalEntry[] = [
  entry(1, '2026-09-01', [[1, 'debit', 100000], [4, 'credit', 100000]]),
  entry(2, '2026-09-25', [[1, 'debit', 300000], [3, 'credit', 300000]]),
  entry(3, '2026-09-26', [[2, 'debit', 20000], [1, 'credit', 20000]]),
  entry(4, '2026-10-05', [[2, 'debit', 5000], [1, 'credit', 5000]]),
  entry(5, '2026-10-06', [[5, 'debit', 3000], [1, 'credit', 3000]]),
  entry(6, '2026-10-07', [[6, 'debit', 700], [1, 'credit', 700]], 2),
]

describe('resolveTopExpenseGroups', () => {
  it('費用の最上位グループを並び順に返す(入れ子のグループは最上位にまとめる)', () => {
    const top = resolveTopExpenseGroups(groups, accounts)
    expect(top.groupIdByAccountId.get(2)).toBe(10)
    expect(top.groupIdByAccountId.get(5)).toBe(12)
    expect(top.groupIdByAccountId.get(6)).toBeUndefined()
    expect(top.series.map((s) => s.name)).toEqual(['生活', '趣味'])
  })

  it('最上位グループが6つ以上あるときは、先頭の5つだけを系列にし、残りは「その他」に入れる', () => {
    const many = Array.from({ length: 7 }, (_, i) => group(20 + i, `G${i}`, null))
    const manyAccounts = many.map((g) => account(g.id + 100, 'expense', `科目${g.id}`, g.id))
    const top = resolveTopExpenseGroups(many, manyAccounts)
    expect(top.series).toHaveLength(5)
    expect(top.groupIdByAccountId.get(many[6].id + 100)).toBeUndefined()
  })
})

describe('buildMonthlySummaries', () => {
  const months = ['2026-09', '2026-10']
  const top = resolveTopExpenseGroups(groups, accounts)

  it('月ごとの収益・費用・収支を返す', () => {
    const [sep, oct] = buildMonthlySummaries(entries, accounts, months, {}, top)
    expect([sep.revenue, sep.expense, sep.net]).toEqual([300000, 20000, 280000])
    expect([oct.revenue, oct.expense, oct.net]).toEqual([0, 8700, -8700])
  })

  it('月末の純資産は、初期残高と損益の累計の合計(BSの純資産合計)になる', () => {
    const [sep, oct] = buildMonthlySummaries(entries, accounts, months, {}, top)
    expect(sep.equity).toBe(100000 + 280000)
    expect(oct.equity).toBe(100000 + 280000 - 8700)
  })

  it('費用を最上位グループ別に集計し、グループ外の科目は「その他」に入れる', () => {
    const [, oct] = buildMonthlySummaries(entries, accounts, months, {}, top)
    expect(oct.expenseByGroup).toEqual({ '10': 5000, '12': 3000, other: 700 })
  })

  it('グループ別の合計は、月の費用と一致する', () => {
    for (const month of buildMonthlySummaries(entries, accounts, months, {}, top)) {
      expect(Object.values(month.expenseByGroup).reduce((sum, v) => sum + v, 0)).toBe(month.expense)
    }
  })

  it('世帯メンバーで絞り込むと、各月の集計にも適用される', () => {
    const [, oct] = buildMonthlySummaries(entries, accounts, months, { householdMemberIds: [2] }, top)
    expect(oct.expense).toBe(700)
    expect(oct.expenseByGroup).toEqual({ other: 700 })
  })

  it('月のラベル用に年と月を持つ', () => {
    const [sep] = buildMonthlySummaries(entries, accounts, months, {}, top)
    expect(sep.month).toBe('2026-09')
  })
})
