/**
 * describeAutoBalanceAdjustment の単体テスト(外部依存なしの純粋関数)。
 *
 * 検証対象: 自動調整仕訳(source_type = 'auto_balance_adjustment'、計画Issue #205)から、詳細パネルに出す
 * 「対象の科目」「元手か調整か」「ずれた期間」を求める。摘要は「残高の自動調整(科目名 MM/DD〜MM/DD)」の形で、
 * 期間の年は仕訳の日付(区間の終わり)から補う。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from './JournalEntry'
import { describeAutoBalanceAdjustment } from './describeAutoBalanceAdjustment'

const entry = (overrides: Partial<JournalEntry>): JournalEntry => ({
  id: 1,
  entryDate: '2026-02-28',
  memo: '残高の自動調整(現金 02/01〜02/28)',
  comment: null,
  currency: 'JPY',
  sourceType: 'auto_balance_adjustment',
  householdMemberId: 1,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [
    { id: 1, journalEntryId: 1, accountId: 10, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side: 'credit', amount: 1000, createdAt: '' },
    { id: 2, journalEntryId: 1, accountId: 99, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side: 'debit', amount: 1000, createdAt: '' },
  ],
  ...overrides,
})

describe('describeAutoBalanceAdjustment', () => {
  it('調整の仕訳は、ずれた期間(開始日〜終了日)を摘要と仕訳日から求める', () => {
    const result = describeAutoBalanceAdjustment(entry({}), (id) => id === 99)

    expect(result).toMatchObject({ kind: 'adjustment', periodStart: '2026-02-01', periodEnd: '2026-02-28' })
  })

  it('期間が年をまたぐ場合は、開始日を前の年にする', () => {
    const result = describeAutoBalanceAdjustment(
      entry({ entryDate: '2026-01-31', memo: '残高の自動調整(現金 12/01〜01/31)' }),
      (id) => id === 99,
    )

    expect(result).toMatchObject({ periodStart: '2025-12-01', periodEnd: '2026-01-31' })
  })

  it('元手(初期残高)の仕訳は期間を持たない', () => {
    const result = describeAutoBalanceAdjustment(entry({ memo: '初期残高(現金)' }), (id) => id === 99)

    expect(result).toMatchObject({ kind: 'capital', periodStart: null })
  })

  it('対象の科目は、相手科目(元手・調整のシステム管理科目)ではない側の明細行の科目になる', () => {
    expect(describeAutoBalanceAdjustment(entry({}), (id) => id === 99)?.accountId).toBe(10)
  })

  it('自動調整の仕訳でなければnullを返す', () => {
    expect(describeAutoBalanceAdjustment(entry({ sourceType: 'manual' }), () => false)).toBeNull()
  })
})
