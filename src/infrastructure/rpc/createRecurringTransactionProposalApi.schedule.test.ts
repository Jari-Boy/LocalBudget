/**
 * createRecurringTransactionProposalApi の、回ごとの金額表(amount_mode = 'schedule'、計画Issue #180)に関する
 * 統合テスト。n回目の提案が表のn回目の金額になること(同時に保留中の複数の提案は、1件目が生成済み+1回目、
 * 2件目がその次の回)、見送っても回は進まないこと、表の最後の回まで生成したら提案が止まること、無効化→
 * 再有効化しても回が抜けないこと、金額が0の行は仕訳に含めないこと、まとめて確定でも回ごとの金額になることを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import type { RecurringScheduleRound } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'
import { createRecurringTransactionProposalApi } from './createRecurringTransactionProposalApi'

let db: Database
let api: ReturnType<typeof createRecurringTransactionProposalApi>
let rules: SqlJsRecurringTransactionRuleRepository
let loanId: number
let interestId: number
let bankId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  loanId = accounts.create({ category: 'liability', name: '住宅ローン', isReconcilable: false }).id
  interestId = accounts.create({ category: 'expense', name: '支払利息', isReconcilable: null }).id
  bankId = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: false }).id
  rules = new SqlJsRecurringTransactionRuleRepository(db)
  api = createRecurringTransactionProposalApi(db, new SqlJsJournalEntryRepository(db))
})

afterEach(() => {
  vi.useRealTimers()
})

const round = (n: number, principal: number, interest: number): RecurringScheduleRound => ({
  round: n,
  amounts: [
    { lineNo: 1, amount: principal },
    { lineNo: 2, amount: interest },
    { lineNo: 3, amount: principal + interest },
  ],
})

function createLoan(schedule: RecurringScheduleRound[]) {
  return rules.create({
    name: '住宅ローン返済',
    bookkeeperHouseholdMemberId: memberId,
    lines: [
      { side: 'debit', accountId: loanId, amount: 1 },
      { side: 'debit', accountId: interestId, amount: 1 },
      { side: 'credit', accountId: bankId, amount: 1 },
    ],
    schedule,
    amountMode: 'schedule',
    frequency: 'monthly',
    dayOfMonth: 27,
    startsOn: '2026-01-01',
  })
}

const now = (iso: string) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

const amountsOf = (lines: { lineNo: number; amount: number }[]) => lines.map((l) => l.amount)

describe('提案の金額(n回目は表のn回目)', () => {
  it('保留中の提案は、生成済みの件数+1回目から順に、回ごとの金額と一覧の金額(借方の合計)を持つ', () => {
    createLoan([round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)])
    now('2026-02-28T00:00:00Z')

    const pending = api.listPending()

    expect(pending.map((p) => p.dueDate)).toEqual(['2026-01-27', '2026-02-27'])
    expect(pending.map((p) => amountsOf(p.defaultLines))).toEqual([
      [100, 10, 110],
      [102, 8, 110],
    ])
    expect(pending.map((p) => p.defaultAmount)).toEqual([110, 110])
  })

  it('確定すると、その回の金額の仕訳ができ、次の提案は次の回の金額になる', () => {
    const rule = createLoan([round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)])
    now('2026-02-28T00:00:00Z')

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-01-27' })

    expect(entry.lines.map((l) => [l.accountId, l.side, l.amount])).toEqual([
      [loanId, 'debit', 100],
      [interestId, 'debit', 10],
      [bankId, 'credit', 110],
    ])
    expect(api.listPending().map((p) => amountsOf(p.defaultLines))).toEqual([[102, 8, 110]])
  })

  it('見送っても回は進まない(見送った回の分の表は、次の提案に使われる)', () => {
    const rule = createLoan([round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)])
    now('2026-02-28T00:00:00Z')

    api.skip({ ruleId: rule.id, dueDate: '2026-01-27' })

    expect(api.listPending().map((p) => [p.dueDate, amountsOf(p.defaultLines)])).toEqual([['2026-02-27', [100, 10, 110]]])
  })

  it('表の最後の回まで生成したら、提案が止まる', () => {
    const rule = createLoan([round(1, 100, 10), round(2, 102, 8)])
    now('2026-12-31T00:00:00Z')

    api.confirmMany({
      items: [
        { ruleId: rule.id, dueDate: '2026-01-27' },
        { ruleId: rule.id, dueDate: '2026-02-27' },
      ],
    })

    expect(api.listPending()).toEqual([])
  })

  it('無効化→再有効化しても、回は抜けない(回は生成済みの件数で数える)', () => {
    const rule = createLoan([round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)])
    now('2026-01-28T00:00:00Z')
    api.confirm({ ruleId: rule.id, dueDate: '2026-01-27' })
    rules.deactivate(rule.id)
    now('2026-04-28T00:00:00Z')
    rules.activate(rule.id, '2026-04-01')

    const [next] = api.listPending()

    expect(next.dueDate).toBe('2026-04-27')
    expect(amountsOf(next.defaultLines)).toEqual([102, 8, 110])
  })

  it('まとめて確定しても、各提案はその回の金額で確定される', () => {
    const rule = createLoan([round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)])
    now('2026-03-31T00:00:00Z')

    const entries = api.confirmMany({
      items: [
        { ruleId: rule.id, dueDate: '2026-01-27' },
        { ruleId: rule.id, dueDate: '2026-02-27' },
        { ruleId: rule.id, dueDate: '2026-03-27' },
      ],
    })

    expect(entries.map((e) => e.lines.map((l) => l.amount))).toEqual([
      [100, 10, 110],
      [102, 8, 110],
      [98, 4, 102],
    ])
  })

  it('金額が0の行は、仕訳に含めない(利息が0の回)', () => {
    const rule = createLoan([round(1, 100, 0)])
    now('2026-01-28T00:00:00Z')

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-01-27' })

    expect(entry.lines.map((l) => [l.accountId, l.amount])).toEqual([
      [loanId, 100],
      [bankId, 100],
    ])
  })
})
