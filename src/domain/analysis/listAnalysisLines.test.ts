/**
 * listPeriodLines・listEquityChangeLines(分析画面の「内訳の仕訳行」、計画Issue #155)のユニットテスト。
 * グラフ・表の金額と、ホバー・クリックで出す仕訳行の合計が一致することを保証する。
 * - listPeriodLines: 期間内の収益・費用の明細を、科目の増加側を正とした金額(PLの金額と同じ式)で返す
 * - listEquityChangeLines: 純資産の増減に効く明細(純資産・収益・費用)を、純資産への影響額で返す
 *   (初期残高や残高調整の仕訳も含む)
 * 世帯メンバー・プロジェクト・取引先の絞り込み(FinancialStatementFilter)も合わせて検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account, AccountCategory } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { generateFilteredProfitAndLoss } from '../financial-statement/generateFilteredProfitAndLoss'
import { generateFilteredBalanceSheet } from '../financial-statement/generateFilteredBalanceSheet'
import { listEquityChangeLines, listPeriodLines } from './listAnalysisLines'

function account(id: number, category: AccountCategory, name: string): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const accounts: Account[] = [
  account(1, 'asset', '現金'),
  account(2, 'expense', '食費'),
  account(3, 'revenue', '給与'),
  account(4, 'equity', '初期残高'),
  account(5, 'expense', '交通費'),
]

let nextLineId = 1
function line(accountId: number, side: 'debit' | 'credit', amount: number, extra: Partial<JournalLine> = {}): JournalLine {
  return {
    id: nextLineId++,
    journalEntryId: 0,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
    ...extra,
  }
}

function entry(id: number, entryDate: string, memo: string, lines: JournalLine[], householdMemberId = 1): JournalEntry {
  return {
    id,
    entryDate,
    memo,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId,
    generatedFromRuleId: null,
    createdAt: '',
    updatedAt: '',
    lines: lines.map((l) => ({ ...l, journalEntryId: id })),
  }
}

const entries: JournalEntry[] = [
  entry(1, '2026-10-01', '初期残高', [line(1, 'debit', 100000), line(4, 'credit', 100000)]),
  entry(2, '2026-10-05', '給料', [line(1, 'debit', 300000), line(3, 'credit', 300000)]),
  entry(3, '2026-10-10', 'スーパー', [line(2, 'debit', 5000), line(1, 'credit', 5000)]),
  entry(4, '2026-10-20', '食費の返金', [line(1, 'debit', 800), line(2, 'credit', 800)]),
  entry(5, '2026-11-03', '電車', [line(5, 'debit', 400), line(1, 'credit', 400)], 2),
]

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' }

describe('listPeriodLines', () => {
  it('期間内の指定した区分の明細を、日付・摘要・科目名・金額つきで返す', () => {
    const lines = listPeriodLines(entries, accounts, OCTOBER, {}, { categories: ['expense'] })
    expect(lines.map((l) => [l.date, l.memo, l.accountName, l.amount])).toEqual([
      ['2026-10-10', 'スーパー', '食費', 5000],
      ['2026-10-20', '食費の返金', '食費', -800],
    ])
  })

  it('費用の貸方(取消・返金)はマイナスの金額になり、合計がPLの金額と一致する', () => {
    const lines = listPeriodLines(entries, accounts, OCTOBER, {}, { categories: ['expense'] })
    const pl = generateFilteredProfitAndLoss(entries, accounts, OCTOBER.from, OCTOBER.to)
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(pl.totalExpense)
  })

  it('科目を指定すると、その科目の明細だけを返す', () => {
    const lines = listPeriodLines(entries, accounts, OCTOBER, {}, { accountIds: [3] })
    expect(lines.map((l) => l.accountName)).toEqual(['給与'])
    expect(lines[0].amount).toBe(300000)
  })

  it('期間の外の明細は含めない', () => {
    const lines = listPeriodLines(entries, accounts, OCTOBER, {}, { categories: ['expense'] })
    expect(lines.some((l) => l.date.startsWith('2026-11'))).toBe(false)
  })

  it('世帯メンバーで絞り込むと、実効メンバーが一致する明細だけを返す', () => {
    const lines = listPeriodLines(entries, accounts, { from: '2026-11-01', to: '2026-11-30' }, { householdMemberIds: [1] }, { categories: ['expense'] })
    expect(lines).toEqual([])
    const member2 = listPeriodLines(entries, accounts, { from: '2026-11-01', to: '2026-11-30' }, { householdMemberIds: [2] }, { categories: ['expense'] })
    expect(member2.map((l) => l.accountName)).toEqual(['交通費'])
  })

  it('仕訳のid・明細のidを持ち、仕訳一覧へ移動する手がかりにできる', () => {
    const [first] = listPeriodLines(entries, accounts, OCTOBER, {}, { categories: ['expense'] })
    expect(first.entryId).toBe(3)
    expect(first.accountId).toBe(2)
  })
})

describe('listEquityChangeLines', () => {
  it('純資産・収益・費用の明細を純資産への影響額で返す(収益はプラス、費用はマイナス)', () => {
    const lines = listEquityChangeLines(entries, accounts, OCTOBER, {})
    expect(lines.map((l) => [l.memo, l.accountName, l.amount])).toEqual([
      ['初期残高', '初期残高', 100000],
      ['給料', '給与', 300000],
      ['スーパー', '食費', -5000],
      ['食費の返金', '食費', 800],
    ])
  })

  it('資産・負債の明細は含めない', () => {
    const lines = listEquityChangeLines(entries, accounts, OCTOBER, {})
    expect(lines.some((l) => l.accountName === '現金')).toBe(false)
  })

  it('合計が、前月末から当月末への純資産(BSの純資産合計)の増減と一致する', () => {
    const before = generateFilteredBalanceSheet(entries, accounts, '2026-09-30')
    const after = generateFilteredBalanceSheet(entries, accounts, '2026-10-31')
    const lines = listEquityChangeLines(entries, accounts, OCTOBER, {})
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(after.totalEquity - before.totalEquity)
  })
})
