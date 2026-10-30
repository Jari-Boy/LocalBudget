/**
 * findUnsettledEntries / findUnsettledLines(未消込エントリ・未消込明細行の判定)の純粋関数としての
 * ユニットテスト。docs/domain/settlement.md 1.6の「消込残高が0より大きいものを未消込として抽出する」
 * ルール(計画Issue #132で明細行単位に変更)を、消込完了・未消込・リンク0件・過剰消込(マイナス残高は
 * 未消込に含めない)・同一仕訳内の複数の一時勘定行・消込仕訳自身が候補に含まれないことを含めて検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { findUnsettledEntries, findUnsettledLines } from './findUnsettledEntries'

const LIABILITY_ACCOUNT_ID = 10

function buildLine(overrides: Partial<JournalLine> & Pick<JournalLine, 'id' | 'journalEntryId' | 'amount'>): JournalLine {
  return {
    accountId: LIABILITY_ACCOUNT_ID,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side: 'credit',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntryWithLines(id: number, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    generatedFromRuleId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines,
  }
}

/** 費用の借方行(id * 10 + 1)と一時勘定の貸方行(id * 10 + 2)から成る暫定計上の仕訳 */
function buildToEntry(id: number, temporaryLineAmount: number): JournalEntry {
  return buildEntryWithLines(id, [
    buildLine({ id: id * 10 + 1, journalEntryId: id, accountId: 999, side: 'debit', amount: temporaryLineAmount }),
    buildLine({ id: id * 10 + 2, journalEntryId: id, amount: temporaryLineAmount }),
  ])
}

function temporaryLineId(entryId: number): number {
  return entryId * 10 + 2
}

function buildSettlesLink(toLineId: number, amount: number, id: number, fromLineId = 1000 + id): JournalEntryLink {
  return {
    id,
    fromLineId,
    toLineId,
    fromEntryId: 100 + id,
    toEntryId: Math.floor(toLineId / 10),
    linkType: 'settles',
    amount,
    createdAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('findUnsettledEntries', () => {
  it('settlesリンクが1件もない元仕訳は未消込として抽出する', () => {
    const entry = buildToEntry(1, 80000)

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, new Map())

    expect(result).toEqual([entry])
  })

  it('消込残高が0(消込完了)の元仕訳は抽出しない', () => {
    const entry = buildToEntry(1, 80000)
    const links = new Map([[entry.id, [buildSettlesLink(temporaryLineId(1), 80000, 1)]]])

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([])
  })

  it('分割消込の途中(消込残高が0より大きい)の元仕訳は未消込として抽出する', () => {
    const entry = buildToEntry(1, 120000)
    const links = new Map([[entry.id, [buildSettlesLink(temporaryLineId(1), 10000, 1)]]])

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([entry])
  })

  it('過剰消込(消込残高がマイナス)の元仕訳は未消込として抽出しない', () => {
    const entry = buildToEntry(1, 80000)
    const links = new Map([[entry.id, [buildSettlesLink(temporaryLineId(1), 100000, 1)]]])

    const result = findUnsettledEntries([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([])
  })

  it('複数の元仕訳から未消込のものだけを抽出する', () => {
    const settledEntry = buildToEntry(1, 50000)
    const unsettledEntry = buildToEntry(2, 30000)
    const links = new Map([[settledEntry.id, [buildSettlesLink(temporaryLineId(1), 50000, 1)]]])

    const result = findUnsettledEntries([settledEntry, unsettledEntry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([unsettledEntry])
  })

  it('消込仕訳自身(一時勘定行がsettlesリンクのfrom_lineになっている仕訳)は、タグ一致だけでは区別できなくても候補に含まれない', () => {
    const toEntry = buildToEntry(1, 80000)
    // 消込仕訳: 同じ一時勘定科目の借方行(id: 52)を持つ。リンクのfrom_lineがこの行
    const settlementEntry = buildEntryWithLines(5, [
      buildLine({ id: 52, journalEntryId: 5, side: 'debit', amount: 30000 }),
      buildLine({ id: 51, journalEntryId: 5, accountId: 999, side: 'credit', amount: 30000 }),
    ])
    const link = buildSettlesLink(temporaryLineId(1), 30000, 1, 52)
    const links = new Map([
      [toEntry.id, [link]],
      [settlementEntry.id, [link]],
    ])

    const result = findUnsettledEntries([toEntry, settlementEntry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toEqual([toEntry])
  })
})

describe('findUnsettledLines', () => {
  it('同一仕訳に一時勘定行が複数あっても、行ごとの消込残高で未消込かどうかを判定する', () => {
    const entry = buildEntryWithLines(1, [
      buildLine({ id: 11, journalEntryId: 1, accountId: 999, side: 'debit', amount: 100000 }),
      buildLine({ id: 12, journalEntryId: 1, householdMemberId: 1, amount: 60000 }),
      buildLine({ id: 13, journalEntryId: 1, householdMemberId: 2, amount: 40000 }),
    ])
    // 世帯メンバー2の債務(行13)だけが完済
    const links = new Map([[entry.id, [buildSettlesLink(13, 40000, 1)]]])

    const result = findUnsettledLines([entry], LIABILITY_ACCOUNT_ID, links)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ entry, balance: 60000 })
    expect(result[0].line.id).toBe(12)
  })

  it('分割消込の途中の行は、元の金額ではなく消込残高を返す', () => {
    const entry = buildToEntry(1, 120000)
    const links = new Map([[entry.id, [buildSettlesLink(temporaryLineId(1), 30000, 1)]]])

    const [unsettled] = findUnsettledLines([entry], LIABILITY_ACCOUNT_ID, links)

    expect(unsettled.balance).toBe(90000)
  })

  it('対象の科目以外の行や、リンクの無い無関係な仕訳の行は含めない', () => {
    const entry = buildToEntry(1, 5000)

    expect(findUnsettledLines([entry], 12345, new Map())).toEqual([])
  })
})
