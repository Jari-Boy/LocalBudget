/**
 * SqlJsRecurringTransactionRuleRepository の、回ごとの金額表(recurring_transaction_rule_amounts、
 * amount_mode = 'schedule'、計画Issue #180)に関する統合テスト。sql.js(SQLite WASM)をNode上で実際に動かし、
 * 金額表の保存・参照、貸借が一致しない回・回が連続しない表・行の金額が欠ける表の拒否、金額表でないルールに
 * 表を付けられないこと、金額表のルールの行の金額が1回目の金額になること、確定済みの回の金額は編集できず
 * (未確定の回は編集できる)、ルールを削除すると表も消えることを検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { InvalidRecurringScheduleError } from '../../domain/recurring-transaction/InvalidRecurringScheduleError'
import type { RecurringScheduleRound } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'

let db: Database
let repository: SqlJsRecurringTransactionRuleRepository
let loanId: number
let interestId: number
let bankId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsRecurringTransactionRuleRepository(db)
  loanId = insertAccount('liability', '住宅ローン')
  interestId = insertAccount('expense', '支払利息')
  bankId = insertAccount('asset', '普通預金')
  db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
  memberId = lastId()
})

const LINES = () =>
  [
    { side: 'debit', accountId: loanId, amount: 1 },
    { side: 'debit', accountId: interestId, amount: 1 },
    { side: 'credit', accountId: bankId, amount: 1 },
  ] as const

function round(n: number, principal: number, interest: number): RecurringScheduleRound {
  return {
    round: n,
    amounts: [
      { lineNo: 1, amount: principal },
      { lineNo: 2, amount: interest },
      { lineNo: 3, amount: principal + interest },
    ],
  }
}

const SCHEDULE = () => [round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)]

function create(schedule: RecurringScheduleRound[] = SCHEDULE()) {
  return repository.create({
    name: '住宅ローン返済',
    lines: [...LINES()],
    schedule,
    amountMode: 'schedule',
    frequency: 'monthly',
    dayOfMonth: 27,
    startsOn: '2026-01-01',
  })
}

describe('金額表の保存と参照', () => {
  it('金額表のルールを作成でき、回の昇順・行番号の昇順で読み出せる', () => {
    const created = create()

    const found = repository.findById(created.id)!

    expect(found.amountMode).toBe('schedule')
    expect(found.schedule).toEqual(SCHEDULE())
  })

  it('ルールの行の金額は、1回目の金額になる', () => {
    const created = create()

    expect(created.lines.map((l) => l.amount)).toEqual([100, 10, 110])
  })

  it('金額表でないルールの金額表は空', () => {
    const created = repository.create({
      name: '家賃',
      lines: [
        { side: 'debit', accountId: interestId, amount: 5 },
        { side: 'credit', accountId: bankId, amount: 5 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(created.schedule).toEqual([])
  })

  it('金額表を差し替えて更新できる(未確定のルール)', () => {
    const created = create()

    const updated = repository.update(created.id, {
      name: '住宅ローン返済',
      lines: [...LINES()],
      schedule: [round(1, 50, 5), round(2, 50, 5)],
      amountMode: 'schedule',
      frequency: 'monthly',
      dayOfMonth: 27,
    })

    expect(updated.schedule).toEqual([round(1, 50, 5), round(2, 50, 5)])
    expect(updated.lines.map((l) => l.amount)).toEqual([50, 5, 55])
  })

  it('ルールを削除すると、金額表も消える', () => {
    const created = create()

    repository.delete(created.id)

    expect(db.exec('SELECT COUNT(*) FROM recurring_transaction_rule_amounts')[0].values[0][0]).toBe(0)
  })
})

describe('金額表の検証', () => {
  it('金額表のルールに表が無い(空)と作成できない', () => {
    expect(() => create([])).toThrow(InvalidRecurringScheduleError)
  })

  it('貸借が一致しない回がある表は保存できず、ルールも残らない', () => {
    const off: RecurringScheduleRound = {
      round: 2,
      amounts: [{ lineNo: 1, amount: 100 }, { lineNo: 2, amount: 10 }, { lineNo: 3, amount: 999 }],
    }

    expect(() => create([round(1, 100, 10), off])).toThrow(InvalidRecurringScheduleError)
    expect(repository.findAll()).toEqual([])
  })

  it('回が連続していない表・行の金額が欠ける表は保存できない', () => {
    expect(() => create([round(1, 1, 1), round(3, 1, 1)])).toThrow(InvalidRecurringScheduleError)
    expect(() => create([{ round: 1, amounts: [{ lineNo: 1, amount: 5 }] }])).toThrow(InvalidRecurringScheduleError)
  })

  it('金額表でないルールに表を付けて保存することはできない', () => {
    expect(() =>
      repository.create({
        name: '家賃',
        lines: [
          { side: 'debit', accountId: interestId, amount: 5 },
          { side: 'credit', accountId: bankId, amount: 5 },
        ],
        schedule: [round(1, 1, 1)],
        frequency: 'monthly',
        dayOfMonth: 1,
      }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('金額が0の行を含む回(利息が0など)は有効', () => {
    expect(() => create([round(1, 100, 0)])).not.toThrow()
  })

  it('金額表でないルールの行の金額は、正の整数でなければならない(0は不可)', () => {
    expect(() =>
      repository.create({
        name: '家賃',
        lines: [
          { side: 'debit', accountId: interestId, amount: 0 },
          { side: 'credit', accountId: bankId, amount: 0 },
        ],
        frequency: 'monthly',
        dayOfMonth: 1,
      }),
    ).toThrow()
  })
})

describe('確定済みの回の金額は編集できない', () => {
  function generate(ruleId: number, count: number) {
    for (let i = 1; i <= count; i += 1) {
      db.run(
        `INSERT INTO journal_entries (entry_date, source_type, generated_from_rule_id, recurring_due_date, household_member_id)
         VALUES (?, 'recurring_generated', ?, ?, ?)`,
        [`2026-0${i}-27`, ruleId, `2026-0${i}-27`, memberId],
      )
    }
  }
  const update = (id: number, schedule: RecurringScheduleRound[]) =>
    repository.update(id, {
      name: '住宅ローン返済',
      lines: [...LINES()],
      schedule,
      amountMode: 'schedule',
      frequency: 'monthly',
      dayOfMonth: 27,
    })

  it('確定済みの回(生成済みの件数まで)の金額を変えると拒否され、表は元のまま', () => {
    const created = create()
    generate(created.id, 1)

    expect(() => update(created.id, [round(1, 999, 10), round(2, 102, 8), round(3, 98, 4)])).toThrow(
      InvalidRecurringScheduleError,
    )
    expect(repository.findById(created.id)!.schedule).toEqual(SCHEDULE())
  })

  it('確定済みの回より後(未確定の回)は編集でき、回数も変えられる', () => {
    const created = create()
    generate(created.id, 1)

    const updated = update(created.id, [round(1, 100, 10), round(2, 200, 20)])

    expect(updated.schedule).toEqual([round(1, 100, 10), round(2, 200, 20)])
  })

  it('確定済みの回を削る(表を生成済みの件数より短くする)ことはできない', () => {
    const created = create()
    generate(created.id, 2)

    expect(() => update(created.id, [round(1, 100, 10)])).toThrow(InvalidRecurringScheduleError)
  })
})

function lastId(): number {
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
}

function insertAccount(category: string, name: string): number {
  db.run(`INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, ?)`, [
    category,
    name,
    category === 'asset' || category === 'liability' ? 0 : null,
  ])
  return lastId()
}
