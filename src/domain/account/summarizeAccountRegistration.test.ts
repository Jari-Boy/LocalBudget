/**
 * summarizeAccountRegistration(計画Issue #189)のユニットテスト。
 * 資産・負債科目の右パネルに出す「登録時の設定」を、科目と仕訳から求める純粋関数を検証する。
 * 照合可否(is_reconcilable)から残高情報の有無を、source_type='initial_balance'の仕訳から
 * 初期残高(金額・日付)を求める。資産・負債以外は対象外(null)。
 * 外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from './Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { summarizeAccountRegistration } from './summarizeAccountRegistration'

const account = (overrides: Partial<Account>): Account => ({
  id: 1,
  category: 'asset',
  name: '銀行',
  isReconcilable: true,
  hasExternalStatement: true,
  isActive: true,
  isSystemManaged: false,
  householdMemberId: null,
  accountGroupId: null,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

const line = (overrides: Partial<JournalLine>): JournalLine => ({
  id: 1,
  journalEntryId: 1,
  accountId: 1,
  projectId: null,
  householdMemberId: 1,
  counterpartyId: null,
  settlementBatchId: null,
  side: 'debit',
  amount: 1000,
  createdAt: '',
  ...overrides,
})

const entry = (overrides: Partial<JournalEntry>): JournalEntry => ({
  id: 1,
  entryDate: '2026-04-01',
  memo: null,
  comment: null,
  currency: 'JPY',
  sourceType: 'initial_balance',
  householdMemberId: 1,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [],
  ...overrides,
})

describe('summarizeAccountRegistration', () => {
  it('照合可否がtrueの科目は、残高情報ありと求まる', () => {
    expect(summarizeAccountRegistration(account({ isReconcilable: true }), [])?.hasBalanceInfo).toBe(true)
  })

  it('照合可否がfalseの科目は、残高情報なしと求まる', () => {
    expect(summarizeAccountRegistration(account({ isReconcilable: false }), [])?.hasBalanceInfo).toBe(false)
  })

  it('資産・負債以外の科目は対象外としてnullを返す', () => {
    expect(summarizeAccountRegistration(account({ category: 'expense', isReconcilable: null }), [])).toBeNull()
    expect(summarizeAccountRegistration(account({ category: 'equity', isReconcilable: null }), [])).toBeNull()
  })

  it('初期残高の仕訳がなければ、初期残高はnull', () => {
    expect(summarizeAccountRegistration(account({}), [])?.initialBalance).toBeNull()
  })

  it('資産科目の初期残高は、初期残高の仕訳の借方の金額と日付で求まる', () => {
    const entries = [entry({ lines: [line({ accountId: 1, side: 'debit', amount: 1250000 })] })]

    expect(summarizeAccountRegistration(account({ id: 1 }), entries)?.initialBalance).toEqual({
      amount: 1250000,
      date: '2026-04-01',
    })
  })

  it('負債科目の初期残高は、貸方の金額で求まる', () => {
    const entries = [entry({ lines: [line({ accountId: 2, side: 'credit', amount: 30000 })] })]

    expect(
      summarizeAccountRegistration(account({ id: 2, category: 'liability', isReconcilable: false }), entries)
        ?.initialBalance,
    ).toEqual({ amount: 30000, date: '2026-04-01' })
  })

  it('他の科目の初期残高や、初期残高以外の仕訳は無視する', () => {
    const entries = [
      entry({ id: 1, lines: [line({ accountId: 9, amount: 500 })] }),
      entry({ id: 2, sourceType: 'manual', lines: [line({ accountId: 1, amount: 700 })] }),
    ]

    expect(summarizeAccountRegistration(account({ id: 1 }), entries)?.initialBalance).toBeNull()
  })
})
