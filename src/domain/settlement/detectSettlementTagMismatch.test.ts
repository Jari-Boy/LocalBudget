/**
 * detectSettlementTagMismatch(タグ不整合の事後検知)の純粋関数としてのユニットテスト。
 * docs/domain/settlement.md 1.8の「to_line側の一時勘定行のタグと、リンクされた消込仕訳側の
 * from_line のタグを比較し、食い違っていれば警告を出す」ルール(計画Issue #132で、仕訳内の
 * 「一致する行が存在するか」という存在チェックから、リンクが指す2行の直接比較に変更)を検証する。
 * タグ一致・科目不一致・貸借が逆でない・project_id不一致・household_member_id不一致・
 * counterparty_id不一致・金額不足を含む。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
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

/** 消込先(to_line)の貸方行と、それを消し込む借方行(from_line)の組 */
function buildPair(toOverrides: Partial<JournalLine>, fromOverrides: Partial<JournalLine>) {
  return {
    toLine: buildLine({ id: 1, side: 'credit', ...toOverrides }),
    fromLine: buildLine({ id: 2, journalEntryId: 2, side: 'debit', ...fromOverrides }),
  }
}

describe('detectSettlementTagMismatch', () => {
  it('科目・タグが一致し貸借が逆の場合はfalse(不整合なし)を返す', () => {
    const { toLine, fromLine } = buildPair(
      { projectId: 5, householdMemberId: 2 },
      { projectId: 5, householdMemberId: 2 },
    )

    expect(detectSettlementTagMismatch(toLine, fromLine, 10000)).toBe(false)
  })

  it('project_idが食い違う場合はtrue(不整合)を返す', () => {
    const { toLine, fromLine } = buildPair({ projectId: 5 }, { projectId: 6 })

    expect(detectSettlementTagMismatch(toLine, fromLine, 10000)).toBe(true)
  })

  it('household_member_idが食い違う場合はtrue(不整合)を返す', () => {
    const { toLine, fromLine } = buildPair({ householdMemberId: 2 }, { householdMemberId: 3 })

    expect(detectSettlementTagMismatch(toLine, fromLine, 10000)).toBe(true)
  })

  it('counterparty_idが食い違う場合はtrue(不整合)を返す', () => {
    const { toLine, fromLine } = buildPair({ counterpartyId: 2 }, { counterpartyId: null })

    expect(detectSettlementTagMismatch(toLine, fromLine, 10000)).toBe(true)
  })

  it('科目が食い違う場合はtrue(不整合)を返す(行の編集で科目が変えられた場合の検知)', () => {
    const { toLine, fromLine } = buildPair({}, { accountId: 99 })

    expect(detectSettlementTagMismatch(toLine, fromLine, 10000)).toBe(true)
  })

  it('貸借が同じ側になっている場合はtrue(不整合)を返す(行の編集で貸借が入れ替えられた場合の検知)', () => {
    const { toLine, fromLine } = buildPair({}, { side: 'credit' })

    expect(detectSettlementTagMismatch(toLine, fromLine, 10000)).toBe(true)
  })

  it('消込仕訳側の行の金額がリンク金額未満の場合はtrue(不整合)を返す', () => {
    const { toLine, fromLine } = buildPair({}, { amount: 4000 })

    expect(detectSettlementTagMismatch(toLine, fromLine, 5000)).toBe(true)
  })

  it('消込仕訳側の行の金額がリンク金額以上であればfalse(不整合なし)を返す', () => {
    const { toLine, fromLine } = buildPair({}, { amount: 8000 })

    expect(detectSettlementTagMismatch(toLine, fromLine, 5000)).toBe(false)
  })
})
