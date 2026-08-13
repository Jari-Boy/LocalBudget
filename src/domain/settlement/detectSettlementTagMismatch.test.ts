/**
 * detectSettlementTagMismatch(タグ不整合の事後検知)の純粋関数としてのユニットテスト。
 * docs/domain/settlement.md 1.8の「to_entry側の一時勘定行のタグと、リンクされた消込仕訳側の
 * 対応行のタグを比較し、食い違っていれば警告を出す」ルールを検証する。既存の作成時ハード検証
 * (SqlJsJournalEntryRepository.assertSettlementTagMatch)と同じ「一致する行が存在するか」という
 * 存在チェックの考え方を踏襲し、タグ一致・project_id不一致・household_member_id不一致・
 * 金額不足・複数行の中の1件が一致する場合を含めて検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { detectSettlementTagMismatch } from './detectSettlementTagMismatch'

const SETTLEMENT_ACCOUNT_ID = 10

function buildLine(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: 1,
    journalEntryId: 1,
    accountId: SETTLEMENT_ACCOUNT_ID,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side: 'credit',
    amount: 10000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntry(id: number, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines,
  }
}

describe('detectSettlementTagMismatch', () => {
  it('to_entry側と消込仕訳側のタグが一致する場合はfalse(不整合なし)を返す', () => {
    const toEntry = buildEntry(1, [buildLine({ projectId: 5, householdMemberId: 2, amount: 10000 })])
    const fromEntry = buildEntry(2, [buildLine({ projectId: 5, householdMemberId: 2, amount: 10000 })])

    expect(detectSettlementTagMismatch(toEntry, fromEntry, SETTLEMENT_ACCOUNT_ID, 10000)).toBe(false)
  })

  it('project_idが食い違う場合はtrue(不整合)を返す', () => {
    const toEntry = buildEntry(1, [buildLine({ projectId: 5, householdMemberId: null, amount: 10000 })])
    const fromEntry = buildEntry(2, [buildLine({ projectId: 6, householdMemberId: null, amount: 10000 })])

    expect(detectSettlementTagMismatch(toEntry, fromEntry, SETTLEMENT_ACCOUNT_ID, 10000)).toBe(true)
  })

  it('household_member_idが食い違う場合はtrue(不整合)を返す', () => {
    const toEntry = buildEntry(1, [buildLine({ projectId: null, householdMemberId: 2, amount: 10000 })])
    const fromEntry = buildEntry(2, [buildLine({ projectId: null, householdMemberId: 3, amount: 10000 })])

    expect(detectSettlementTagMismatch(toEntry, fromEntry, SETTLEMENT_ACCOUNT_ID, 10000)).toBe(true)
  })

  it('消込仕訳側の対応行の金額がリンク金額未満の場合はtrue(不整合)を返す', () => {
    const toEntry = buildEntry(1, [buildLine({ projectId: 5, householdMemberId: null, amount: 10000 })])
    const fromEntry = buildEntry(2, [buildLine({ projectId: 5, householdMemberId: null, amount: 4000 })])

    expect(detectSettlementTagMismatch(toEntry, fromEntry, SETTLEMENT_ACCOUNT_ID, 5000)).toBe(true)
  })

  it('N:Nのケースで消込仕訳側に複数行あり、そのうち1件がタグ一致すればfalse(不整合なし)を返す', () => {
    const toEntry = buildEntry(1, [buildLine({ id: 1, projectId: 100, householdMemberId: null, amount: 10000 })])
    const fromEntry = buildEntry(2, [
      buildLine({ id: 2, projectId: 200, householdMemberId: null, amount: 5000 }),
      buildLine({ id: 3, projectId: 100, householdMemberId: null, amount: 10000 }),
    ])

    expect(detectSettlementTagMismatch(toEntry, fromEntry, SETTLEMENT_ACCOUNT_ID, 10000)).toBe(false)
  })
})
