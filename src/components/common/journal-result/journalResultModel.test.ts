/**
 * 仕訳の結果一覧の1行要約を作る純粋関数のテスト(計画Issue #150)。
 * 借方・貸方それぞれの代表科目(金額が最大の明細行、絞り込み中は一致した行を優先)と
 * 「ほかN件」、仕訳の金額(借方合計)、出どころタグの定義を検証する。
 * 外部依存なし(DB・DOMに依存しない)。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../../../domain/journal/JournalEntry'
import { SOURCE_TAGS, summarizeSide, toJournalResultItem } from './journalResultModel'

const line = (id: number, accountId: number, side: 'debit' | 'credit', amount: number): JournalLine => ({
  id,
  journalEntryId: 1,
  accountId,
  projectId: null,
  householdMemberId: 1,
  counterpartyId: null,
  settlementBatchId: null,
  side,
  amount,
  createdAt: '2026-10-01T00:00:00Z',
})

const names: Record<number, string> = { 1: '食費', 2: '日用品', 3: '楽天カード', 4: '現金' }
const nameOf = (id: number) => names[id] ?? '不明'

describe('summarizeSide', () => {
  it('1行だけの側は科目名だけを返す', () => {
    expect(summarizeSide([line(1, 1, 'debit', 500)], 'debit', nameOf)).toBe('食費')
  })

  it('複数行の側は金額が最大の科目を代表にして「ほかN件」を付ける', () => {
    const lines = [line(1, 1, 'debit', 500), line(2, 2, 'debit', 1200), line(3, 4, 'debit', 100)]
    expect(summarizeSide(lines, 'debit', nameOf)).toBe('日用品 ほか2件')
  })

  it('指定した科目に一致する行があるときは、その中の最大の行を代表にする', () => {
    const lines = [line(1, 1, 'debit', 500), line(2, 2, 'debit', 1200)]
    expect(summarizeSide(lines, 'debit', nameOf, new Set([1]))).toBe('食費 ほか1件')
  })

  it('一致する行がなければ全体の最大の行を代表にする', () => {
    const lines = [line(1, 1, 'debit', 500), line(2, 2, 'debit', 1200)]
    expect(summarizeSide(lines, 'debit', nameOf, new Set([99]))).toBe('日用品 ほか1件')
  })

  it('その側に明細行がなければ「未選択」を返す', () => {
    expect(summarizeSide([line(1, 1, 'debit', 500)], 'credit', nameOf)).toBe('未選択')
  })

  it('反対側の行は数えない', () => {
    const lines = [line(1, 1, 'debit', 500), line(2, 3, 'credit', 500)]
    expect(summarizeSide(lines, 'credit', nameOf)).toBe('楽天カード')
  })
})

describe('toJournalResultItem', () => {
  const entry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
    id: 7,
    entryDate: '2026-10-05',
    memo: 'ランチ',
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
    lines: [line(1, 1, 'debit', 800), line(2, 2, 'debit', 200), line(3, 3, 'credit', 1000)],
    ...overrides,
  })

  it('金額は借方合計、借方・貸方は代表科目の要約になる', () => {
    expect(toJournalResultItem(entry(), nameOf)).toEqual({
      id: 7,
      sourceType: 'manual',
      memo: 'ランチ',
      amount: 1000,
      currency: 'JPY',
      entryDate: '2026-10-05',
      debitSummary: '食費 ほか1件',
      creditSummary: '楽天カード',
    })
  })

  it('摘要が空の仕訳は「(摘要なし)」と表示する', () => {
    expect(toJournalResultItem(entry({ memo: null }), nameOf).memo).toBe('(摘要なし)')
    expect(toJournalResultItem(entry({ memo: '' }), nameOf).memo).toBe('(摘要なし)')
  })
})

describe('SOURCE_TAGS', () => {
  it('作成経路6種すべてにモックアップの表示名が定義されている', () => {
    expect(Object.fromEntries(Object.entries(SOURCE_TAGS).map(([k, v]) => [k, v.label]))).toEqual({
      external_import: '外部明細',
      manual: '手入力',
      expense_splitting: '割勘',
      recurring_generated: '定期',
      initial_balance: '初期残高',
      balance_adjustment: '残高調整',
    })
  })
})
