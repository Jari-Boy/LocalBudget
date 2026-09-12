/**
 * buildRecurringTransactionJournalEntryInput(定期取引ルールからのCreateJournalEntryInput組み立て)
 * の純粋関数としてのユニットテスト。docs/domain/recurring-transactions.md 1.4節「project_id・
 * household_member_idは両行に設定し、counterparty_idはPL区分(revenue/expense)側の行にのみ
 * 設定する」ルールと、2.1節「amountは生成時のレビューで編集可能」を検証する。
 * 科目区分(AccountCategory)の解決は呼び出し側の責務(既存のbuildCounterpartyExpenseSplitting
 * JournalEntryInput等と同じパターン)のため、本関数はDB非依存・外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from './RecurringTransactionRule'
import { buildRecurringTransactionJournalEntryInput } from './buildRecurringTransactionJournalEntryInput'

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
  it('sourceType=recurring_generated・generatedFromRuleId・entryDateを設定する', () => {
    const rule = makeRule({ id: 42 })

    const input = buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate: '2026-09-01',
      bookkeeperHouseholdMemberId: 1,
      debitAccountCategory: 'expense',
      creditAccountCategory: 'liability',
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
    })

    for (const line of input.lines) {
      expect(line.counterpartyId).toBeNull()
    }
  })
})
