/**
 * buildRecurringTransactionJournalEntryInput(定期取引ルールからのCreateJournalEntryInput組み立て)
 * の純粋関数としてのユニットテスト。docs/domain/recurring-transactions.md 1.4節「project_id・
 * household_member_idは両行に設定し、counterparty_idはPL区分(revenue/expense)側の行にのみ
 * 設定する」ルールと、2.1節「amountは生成時のレビューで編集可能」を検証する。
 * 科目区分(AccountCategory)の解決は呼び出し側の責務(既存のbuildCounterpartyExpenseSplitting
 * JournalEntryInput等と同じパターン)のため、本関数はDB非依存・外部依存なし。
 * 明細行の世帯メンバーは、科目の既定メンバー > ルールの世帯メンバー > 起票者の順で必ず確定する
 * (計画Issue #169)。
 */
import { describe, expect, it } from 'vitest'
import { createLineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'
import type { RecurringTransactionRule } from './RecurringTransactionRule'
import { buildRecurringTransactionJournalEntryInput } from './buildRecurringTransactionJournalEntryInput'

/** 科目に既定の世帯メンバーが無い前提で、起票者(1)を既定値にする */
const resolveLineHouseholdMemberId = createLineHouseholdMemberResolver([], 1)

function makeRule(overrides: Partial<RecurringTransactionRule>): RecurringTransactionRule {
  return {
    id: 1,
    name: '家賃',
    debitAccountId: 10,
    creditAccountId: 20,
    amount: 80000,
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 1,
    weekOfMonth: null,
    monthOfYear: null,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    maxOccurrences: null,
    isActive: true,
    createdAt: '2026-06-01 00:00:00',
    updatedAt: '2026-06-01 00:00:00',
    ...overrides,
  }
}

describe('buildRecurringTransactionJournalEntryInput', () => {
  it('ルールに世帯メンバーが無ければ、両行とも起票者になる(明細行は常に世帯メンバーを持つ、計画Issue #169)', () => {
    const input = buildRecurringTransactionJournalEntryInput({
      rule: makeRule({ householdMemberId: null }),
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
    })

    expect(input.lines.map((l) => l.householdMemberId)).toEqual([1, 1])
  })

  it('科目に既定の世帯メンバーがあれば、その行はルールの世帯メンバーより既定値が優先される', () => {
    const input = buildRecurringTransactionJournalEntryInput({
      rule: makeRule({ householdMemberId: 3 }),
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId: createLineHouseholdMemberResolver([{ id: 20, householdMemberId: 9 }], 1),
    })

    expect(input.lines.find((l) => l.side === 'debit')?.householdMemberId).toBe(3)
    expect(input.lines.find((l) => l.side === 'credit')?.householdMemberId).toBe(9)
  })

  it('sourceType=recurring_generated・generatedFromRuleId・entryDateを設定する', () => {
    const rule = makeRule({ id: 42 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
    })

    expect(input.sourceType).toBe('recurring_generated')
    expect(input.generatedFromRuleId).toBe(42)
    expect(input.entryDate).toBe('2026-09-01')
    expect(input.householdMemberId).toBe(1)
  })

  it('amountを省略した場合はルールのamountを両行に使う', () => {
    const rule = makeRule({ amount: 80000 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
    })

    expect(input.lines.map((l) => l.amount)).toEqual([80000, 80000])
  })

  it('amountを指定した場合はレビュー時の編集として両行に上書き反映する(2.1節)', () => {
    const rule = makeRule({ amount: 80000 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
      amount: 85000,
    })

    expect(input.lines.map((l) => l.amount)).toEqual([85000, 85000])
  })

  it('project_id・household_member_id(ルール側)は両行に設定する(1.4節)', () => {
    const rule = makeRule({ projectId: 7, householdMemberId: 3 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
    })

    for (const line of input.lines) {
      expect(line.projectId).toBe(7)
      expect(line.householdMemberId).toBe(3)
    }
  })

  it('counterparty_idはPL区分(expense)側の行にのみ設定する(1.4節)', () => {
    const rule = makeRule({ counterpartyId: 5 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
    })

    const debitLine = input.lines.find((l) => l.side === 'debit')!
    const creditLine = input.lines.find((l) => l.side === 'credit')!
    expect(debitLine.counterpartyId).toBe(5)
    expect(creditLine.counterpartyId).toBeNull()
  })

  it('両行ともBS区分(asset/liability)の場合、counterparty_idはどちらにも設定しない(前払い型の支払いルール等)', () => {
    const rule = makeRule({ counterpartyId: 5 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'asset',
      creditAccountCategory: 'liability',
      resolveLineHouseholdMemberId,
    })

    for (const line of input.lines) {
      expect(line.counterpartyId).toBeNull()
    }
  })
})
