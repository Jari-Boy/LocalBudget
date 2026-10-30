/**
 * calculateLineSettlementBalance / calculateSettlementBalance(消込残高の計算)の純粋関数としての
 * ユニットテスト。docs/domain/settlement.md 1.6の「消込残高 = 消込先の明細行(to_line)の金額 -
 * Σ(journal_entry_links.amount WHERE link_type = 'settles' AND to_line_id = その明細行)」
 * (計画Issue #132で仕訳単位から明細行単位に変更)を、分割消込(複数回のsettlesリンク)・
 * 過剰消込(マイナス残高)・無関係なリンクの除外・同一仕訳内の複数の一時勘定行が互いに混入しないこと・
 * 消込仕訳自身の行が残高計算の対象外であることを含めて検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { calculateLineSettlementBalance, calculateSettlementBalance } from './calculateSettlementBalance'

const LIABILITY_ACCOUNT_ID = 10
const OTHER_LIABILITY_ACCOUNT_ID = 11

function buildLine(overrides: Partial<JournalLine> & Pick<JournalLine, 'id' | 'amount'>): JournalLine {
  return {
    journalEntryId: 1,
    accountId: LIABILITY_ACCOUNT_ID,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side: 'credit',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntry(lines: JournalLine[], id = 1): JournalEntry {
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

/** 費用行(id: 1)と一時勘定の貸方行(id: 2)から成る、暫定計上の仕訳 */
function buildToEntry(temporaryLineAmount: number, id = 1): JournalEntry {
  return buildEntry(
    [
      buildLine({ id: 1, journalEntryId: id, accountId: 999, side: 'debit', amount: temporaryLineAmount }),
      buildLine({ id: 2, journalEntryId: id, amount: temporaryLineAmount }),
    ],
    id,
  )
}

function buildSettlesLink(toLineId: number, amount: number, id: number, fromLineId = 1000 + id): JournalEntryLink {
  return {
    id,
    fromLineId,
    toLineId,
    fromEntryId: 100 + id,
    toEntryId: 1,
    linkType: 'settles',
    amount,
    createdAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('calculateLineSettlementBalance', () => {
  it('その明細行へのsettlesリンクが1件もない場合は明細行の金額がそのまま残高になる', () => {
    expect(calculateLineSettlementBalance(buildLine({ id: 2, amount: 80000 }), [])).toBe(80000)
  })

  it('分割消込(1つの明細行に対する複数のsettlesリンク)の合計を差し引いて残高を計算する', () => {
    const line = buildLine({ id: 2, amount: 120000 })
    const links = [buildSettlesLink(2, 10000, 1), buildSettlesLink(2, 10000, 2), buildSettlesLink(2, 10000, 3)]

    expect(calculateLineSettlementBalance(line, links)).toBe(90000)
  })

  it('消込残高が0になった時点で消込完了とみなせる', () => {
    expect(calculateLineSettlementBalance(buildLine({ id: 2, amount: 120000 }), [buildSettlesLink(2, 120000, 1)])).toBe(0)
  })

  it('過剰消込の場合は消込残高がマイナスになることを許容する', () => {
    expect(calculateLineSettlementBalance(buildLine({ id: 2, amount: 80000 }), [buildSettlesLink(2, 100000, 1)])).toBe(-20000)
  })

  it('他の明細行宛のsettlesリンクやlinkType=allocatesのリンクは残高計算から除外する', () => {
    const line = buildLine({ id: 2, amount: 80000 })
    const links: JournalEntryLink[] = [
      buildSettlesLink(3, 30000, 1),
      { ...buildSettlesLink(2, 5000, 2), linkType: 'allocates' },
    ]

    expect(calculateLineSettlementBalance(line, links)).toBe(80000)
  })
})

describe('calculateSettlementBalance', () => {
  it('settlesリンクが1件もない場合は一時勘定行の金額がそのまま残高になる', () => {
    expect(calculateSettlementBalance(buildToEntry(80000), LIABILITY_ACCOUNT_ID, [])).toBe(80000)
  })

  it('一時勘定行へのsettlesリンクの合計を差し引いて残高を計算する', () => {
    const toEntry = buildToEntry(120000)
    const links = [buildSettlesLink(2, 10000, 1), buildSettlesLink(2, 10000, 2)]

    expect(calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)).toBe(100000)
  })

  it('他の明細行宛のsettlesリンクやlinkType=allocatesのリンクは残高計算から除外する', () => {
    const toEntry = buildToEntry(80000)
    const links: JournalEntryLink[] = [
      buildSettlesLink(999, 30000, 1),
      { ...buildSettlesLink(2, 5000, 2), linkType: 'allocates' },
    ]

    expect(calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)).toBe(80000)
  })

  it('同一仕訳に別の科目の一時勘定行があっても、リンクは行単位で結びつくため科目間で残高が混入しない', () => {
    const toEntry = buildEntry([
      buildLine({ id: 1, accountId: 999, side: 'debit', amount: 150000 }),
      buildLine({ id: 2, accountId: LIABILITY_ACCOUNT_ID, amount: 100000 }),
      buildLine({ id: 3, accountId: OTHER_LIABILITY_ACCOUNT_ID, amount: 50000 }),
    ])
    // 行[3](別の科目の一時勘定)だけを30,000円消し込んだ
    const links = [buildSettlesLink(3, 30000, 1)]

    expect(calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)).toBe(100000)
    expect(calculateSettlementBalance(toEntry, OTHER_LIABILITY_ACCOUNT_ID, links)).toBe(20000)
  })

  it('同一科目の一時勘定行が複数ある場合は、行ごとの消込残高を合計する', () => {
    const toEntry = buildEntry([
      buildLine({ id: 1, accountId: 999, side: 'debit', amount: 100000 }),
      buildLine({ id: 2, householdMemberId: 1, amount: 60000 }),
      buildLine({ id: 3, householdMemberId: 2, amount: 40000 }),
    ])
    const links = [buildSettlesLink(3, 40000, 1)]

    expect(calculateSettlementBalance(toEntry, LIABILITY_ACCOUNT_ID, links)).toBe(60000)
  })

  it('消込仕訳自身の一時勘定行(settlesリンクのfrom_line)は消込対象の残高に含めない(精算仕訳が候補に混入しない)', () => {
    // 消込仕訳: 一時勘定の借方行(id: 20)が消込元(from_line)として他の仕訳を消し込んでいる
    const settlementEntry = buildEntry(
      [
        buildLine({ id: 20, accountId: LIABILITY_ACCOUNT_ID, side: 'debit', amount: 80000 }),
        buildLine({ id: 21, accountId: 999, side: 'credit', amount: 80000 }),
      ],
      5,
    )
    const links = [buildSettlesLink(2, 80000, 1, 20)]

    expect(calculateSettlementBalance(settlementEntry, LIABILITY_ACCOUNT_ID, links)).toBe(0)
  })
})
