/**
 * summarizeAccountsByCategory(区分別の科目内訳集計)の純粋関数としてのユニットテスト。
 * 指定した区分(資産・負債・純資産・収益・費用のいずれか)に属する科目ごとに
 * calculateAccountBalanceの残高計算式(docs/domain/financial-statements.md 2.1節)を適用し、
 * 科目別の内訳一覧を返す。generateProfitAndLoss(revenues/expenses)・
 * generateBalanceSheet(assets/liabilities/equity)の両方から共通利用される、
 * PL/BSどちらにも依存しない集計ロジックであることを検証する。
 * 残高0の科目は内訳から除外されること、他区分の科目が混ざらないことも境界値として含める。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import { summarizeAccountsByCategory } from './summarizeAccountsByCategory'

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    category: 'expense',
    name: 'テスト科目',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildLine(accountId: number, side: 'debit' | 'credit', amount: number): JournalLine {
  return {
    id: 1,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('summarizeAccountsByCategory', () => {
  it('指定した区分の科目ごとに残高を計算して内訳を返す', () => {
    const accounts: Account[] = [
      buildAccount({ id: 1, category: 'expense', name: '食費' }),
      buildAccount({ id: 2, category: 'expense', name: '交通費' }),
    ]
    const lines = [buildLine(1, 'debit', 3000), buildLine(2, 'debit', 1000)]

    expect(summarizeAccountsByCategory(lines, accounts, 'expense')).toEqual([
      { accountId: 1, accountName: '食費', amount: 3000 },
      { accountId: 2, accountName: '交通費', amount: 1000 },
    ])
  })

  it('他区分の科目は内訳に含めない', () => {
    const accounts: Account[] = [
      buildAccount({ id: 1, category: 'expense', name: '食費' }),
      buildAccount({ id: 2, category: 'revenue', name: '給与' }),
    ]
    const lines = [buildLine(1, 'debit', 3000), buildLine(2, 'credit', 250000)]

    expect(summarizeAccountsByCategory(lines, accounts, 'expense')).toEqual([
      { accountId: 1, accountName: '食費', amount: 3000 },
    ])
  })

  it('残高が0の科目は内訳から除外する', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense', name: '食費' })]
    const lines = [buildLine(1, 'debit', 1000), buildLine(1, 'credit', 1000)]

    expect(summarizeAccountsByCategory(lines, accounts, 'expense')).toEqual([])
  })

  it('明細が0件の場合は空配列を返す', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense', name: '食費' })]

    expect(summarizeAccountsByCategory([], accounts, 'expense')).toEqual([])
  })
})
