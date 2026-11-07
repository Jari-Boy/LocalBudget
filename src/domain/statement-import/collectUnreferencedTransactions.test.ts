/**
 * collectUnreferencedTransactions のユニットテスト(計画Issue #145)。
 * 手入力・定期取引生成など、外部明細の突合マスタ(external_transaction_refs)を持たない仕訳を、
 * 確定版候補(docs/domain/statement-import.md 1.6)の探索対象(ExistingTransactionSummary)へ
 * 変換する純粋関数を検証する。符号はImportedRecord.amountと同じ(正 = 対象科目の残高が増える方向)。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { collectUnreferencedTransactions } from './collectUnreferencedTransactions'

function line(overrides: Partial<JournalLine> = {}): JournalLine {
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
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-07-20',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z',
    lines: [line()],
    ...overrides,
  }
}

describe('collectUnreferencedTransactions', () => {
  it('資産科目の手入力仕訳は借方を正、貸方を負の金額として返す', () => {
    const entries = [
      entry({ id: 1, lines: [line({ journalEntryId: 1, side: 'credit', amount: 3000 })] }),
      entry({ id: 2, lines: [line({ journalEntryId: 2, side: 'debit', amount: 500 })] }),
    ]

    const result = collectUnreferencedTransactions(entries, { id: 10, category: 'asset' }, new Set())

    expect(result).toEqual([
      { journalEntryId: 1, entryDate: '2026-07-20', amount: -3000, isSettled: null },
      { journalEntryId: 2, entryDate: '2026-07-20', amount: 500, isSettled: null },
    ])
  })

  it('負債科目では貸方を正、借方を負の金額として返す', () => {
    const entries = [entry({ lines: [line({ side: 'credit', amount: 4000 })] })]

    const result = collectUnreferencedTransactions(entries, { id: 10, category: 'liability' }, new Set())

    expect(result[0].amount).toBe(4000)
  })

  it('突合マスタを持つ仕訳(取込済み)は含めない', () => {
    const entries = [entry({ id: 1 }), entry({ id: 2, lines: [line({ journalEntryId: 2 })] })]

    const result = collectUnreferencedTransactions(entries, { id: 10, category: 'asset' }, new Set([1]))

    expect(result.map((r) => r.journalEntryId)).toEqual([2])
  })

  it('対象科目の明細を持たない仕訳は含めない', () => {
    const entries = [entry({ lines: [line({ accountId: 99 })] })]

    expect(collectUnreferencedTransactions(entries, { id: 10, category: 'asset' }, new Set())).toEqual([])
  })

  it('同じ仕訳内に対象科目の明細が複数あれば符号付きで合算して1件にする', () => {
    const entries = [
      entry({
        lines: [
          line({ id: 1, side: 'debit', amount: 1000 }),
          line({ id: 2, side: 'debit', amount: 200 }),
          line({ id: 3, side: 'credit', amount: 50 }),
          line({ id: 4, accountId: 99, side: 'credit', amount: 1150 }),
        ],
      }),
    ]

    const result = collectUnreferencedTransactions(entries, { id: 10, category: 'asset' }, new Set())

    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(1150)
  })

  it('合算して0になる仕訳は含めない(残高が動かない)', () => {
    const entries = [
      entry({
        lines: [line({ id: 1, side: 'debit', amount: 100 }), line({ id: 2, side: 'credit', amount: 100 })],
      }),
    ]

    expect(collectUnreferencedTransactions(entries, { id: 10, category: 'asset' }, new Set())).toEqual([])
  })
})
