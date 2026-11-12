/**
 * SqlJsRecurringTransactionRuleRepository の、ルールの行(recurring_transaction_rule_lines、計画Issue #180)
 * に関する統合テスト。sql.js(SQLite WASM)をNode上で実際に動かし、3行以上のルールの保存・参照、
 * 貸借が一致しない行構成の拒否(仕訳と同じ検証 assertJournalBalance)、PL科目以外の行への取引先の
 * 設定拒否(DBのTRIGGER)、システム管理の立替金・未払金以外の行への精算バッチの設定拒否、
 * 更新時の行の置き換え、起票者(ルール単位)と行の世帯メンバー(行単位)が別々に保存されること、
 * ルール削除時に行も消えること、前回確定した仕訳の行(findLastConfirmedLines)の取得を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'

let db: Database
let repository: SqlJsRecurringTransactionRuleRepository
let bankId: number
let socialInsuranceId: number
let incomeTaxId: number
let salaryId: number
let payableId: number
let advanceId: number
let memberId: number
let otherMemberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsRecurringTransactionRuleRepository(db)
  bankId = insertAccount('asset', '普通預金')
  socialInsuranceId = insertAccount('expense', '社会保険料')
  incomeTaxId = insertAccount('expense', '所得税')
  salaryId = insertAccount('revenue', '給与収入')
  payableId = insertAccount('liability', '未払金')
  advanceId = insertAccount('asset', '立替金テスト', true)
  memberId = insertMember('自分')
  otherMemberId = insertMember('配偶者')
})

const baseSchedule = { frequency: 'monthly', dayOfMonth: 25 } as const

function salaryLines() {
  return [
    { side: 'debit', accountId: bankId, amount: 280000 },
    { side: 'debit', accountId: socialInsuranceId, amount: 50000 },
    { side: 'debit', accountId: incomeTaxId, amount: 30000 },
    { side: 'credit', accountId: salaryId, amount: 360000 },
  ] as const
}

describe('3行以上のルールの保存と参照', () => {
  it('3行以上の行を作成でき、行番号の順(入力順)で読み出せる', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    const found = repository.findById(created.id)!

    expect(found.lines.map((l) => [l.lineNo, l.side, l.accountId, l.amount])).toEqual([
      [1, 'debit', bankId, 280000],
      [2, 'debit', socialInsuranceId, 50000],
      [3, 'debit', incomeTaxId, 30000],
      [4, 'credit', salaryId, 360000],
    ])
  })

  it('findAllも各ルールの行を持つ', () => {
    repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    expect(repository.findAll()[0].lines).toHaveLength(4)
  })

  it('行の項目(プロジェクト・世帯メンバー・取引先・精算バッチ)を保存できる', () => {
    const projectId = insertProject('旅行')
    const counterpartyId = insertCounterparty('勤務先A')
    const batchId = insertSettlementBatch('旅行2026')
    const created = repository.create({
      name: '給与',
      lines: [
        { side: 'debit', accountId: advanceId, amount: 1000, settlementBatchId: batchId, householdMemberId: otherMemberId },
        { side: 'credit', accountId: salaryId, amount: 1000, projectId, counterpartyId },
      ],
      ...baseSchedule,
    })

    const [debit, credit] = repository.findById(created.id)!.lines

    expect(debit).toMatchObject({ settlementBatchId: batchId, householdMemberId: otherMemberId, projectId: null, counterpartyId: null })
    expect(credit).toMatchObject({ projectId, counterpartyId, settlementBatchId: null, householdMemberId: null })
  })

  it('2行のルールも同じ表で保存する(特別扱いしない)', () => {
    const created = repository.create({
      name: '家賃',
      lines: [
        { side: 'debit', accountId: socialInsuranceId, amount: 80000 },
        { side: 'credit', accountId: payableId, amount: 80000 },
      ],
      ...baseSchedule,
    })

    expect(repository.findById(created.id)!.lines).toHaveLength(2)
  })
})

describe('行構成の検証', () => {
  it('貸借が一致しない行構成は保存できず、ルールも作られない', () => {
    expect(() =>
      repository.create({
        name: '不一致',
        lines: [
          { side: 'debit', accountId: socialInsuranceId, amount: 1000 },
          { side: 'credit', accountId: payableId, amount: 900 },
        ],
        ...baseSchedule,
      }),
    ).toThrow(UnbalancedJournalEntryError)
    expect(repository.findAll()).toEqual([])
  })

  it('行が2行未満のルールは保存できない', () => {
    expect(() =>
      repository.create({ name: '1行', lines: [{ side: 'debit', accountId: socialInsuranceId, amount: 1000 }], ...baseSchedule }),
    ).toThrow(UnbalancedJournalEntryError)
  })

  it('PL科目(収益・費用)以外の行に取引先は設定できない(DBが拒否し、ルールも残らない)', () => {
    const counterpartyId = insertCounterparty('銀行')

    expect(() =>
      repository.create({
        name: '不正な取引先',
        lines: [
          { side: 'debit', accountId: bankId, amount: 1000, counterpartyId },
          { side: 'credit', accountId: salaryId, amount: 1000 },
        ],
        ...baseSchedule,
      }),
    ).toThrow()
    expect(repository.findAll()).toEqual([])
  })

  it('システム管理の立替金・未払金でない科目の行に精算バッチは設定できない', () => {
    const batchId = insertSettlementBatch('旅行2026')

    expect(() =>
      repository.create({
        name: '不正な精算バッチ',
        lines: [
          { side: 'debit', accountId: socialInsuranceId, amount: 1000, settlementBatchId: batchId },
          { side: 'credit', accountId: payableId, amount: 1000 },
        ],
        ...baseSchedule,
      }),
    ).toThrow(SettlementBatchOnNonAdvanceAccountError)
    expect(repository.findAll()).toEqual([])
  })
})

describe('更新', () => {
  it('行を置き換えて保存できる(行の追加・削除・金額の変更)', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    const updated = repository.update(created.id, {
      name: '給与',
      lines: [
        { side: 'debit', accountId: bankId, amount: 300000 },
        { side: 'credit', accountId: salaryId, amount: 300000 },
      ],
      ...baseSchedule,
    })

    expect(updated.lines.map((l) => [l.lineNo, l.accountId, l.amount])).toEqual([
      [1, bankId, 300000],
      [2, salaryId, 300000],
    ])
  })

  it('貸借が一致しない行構成への更新は拒否され、元の行が残る', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    expect(() =>
      repository.update(created.id, {
        name: '給与',
        lines: [
          { side: 'debit', accountId: bankId, amount: 1 },
          { side: 'credit', accountId: salaryId, amount: 2 },
        ],
        ...baseSchedule,
      }),
    ).toThrow(UnbalancedJournalEntryError)
    expect(repository.findById(created.id)!.lines).toHaveLength(4)
  })
})

describe('起票者(ルール単位)と行の世帯メンバー(行単位)', () => {
  it('両者は別々に保存される', () => {
    const created = repository.create({
      name: '給与',
      bookkeeperHouseholdMemberId: memberId,
      lines: [
        { side: 'debit', accountId: bankId, amount: 100, householdMemberId: otherMemberId },
        { side: 'credit', accountId: salaryId, amount: 100 },
      ],
      ...baseSchedule,
    })

    const found = repository.findById(created.id)!

    expect(found.bookkeeperHouseholdMemberId).toBe(memberId)
    expect(found.lines.map((l) => l.householdMemberId)).toEqual([otherMemberId, null])
  })

  it('起票者を指定しなければnull(確定時に選ぶ)', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    expect(created.bookkeeperHouseholdMemberId).toBeNull()
  })
})

describe('削除', () => {
  it('生成済みの仕訳が無いルールを削除すると、行も一緒に消える', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    repository.delete(created.id)

    expect(db.exec('SELECT COUNT(*) FROM recurring_transaction_rule_lines')[0].values[0][0]).toBe(0)
  })
})

describe('findLastConfirmedLines(前回確定した仕訳の行)', () => {
  it('生成済みの仕訳が無ければ空配列を返す', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })

    expect(repository.findLastConfirmedLines(created.id)).toEqual([])
  })

  it('期日が最も新しい生成済みの仕訳の行(科目・借方/貸方・金額)を返す', () => {
    const created = repository.create({ name: '給与', lines: [...salaryLines()], ...baseSchedule })
    const older = insertGeneratedEntry(created.id, '2026-07-25')
    const newer = insertGeneratedEntry(created.id, '2026-08-25')
    insertLine(older, bankId, 'debit', 1)
    insertLine(older, salaryId, 'credit', 1)
    insertLine(newer, bankId, 'debit', 290000)
    insertLine(newer, incomeTaxId, 'debit', 31000)
    insertLine(newer, salaryId, 'credit', 321000)

    expect(repository.findLastConfirmedLines(created.id)).toEqual([
      { accountId: bankId, side: 'debit', amount: 290000 },
      { accountId: incomeTaxId, side: 'debit', amount: 31000 },
      { accountId: salaryId, side: 'credit', amount: 321000 },
    ])
  })
})

function lastId(): number {
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
}

function insertAccount(category: string, name: string, systemManaged = false): number {
  db.run(`INSERT INTO accounts (category, name, is_reconcilable, is_system_managed) VALUES (?, ?, ?, ?)`, [
    category,
    name,
    category === 'asset' || category === 'liability' ? 0 : null,
    systemManaged ? 1 : 0,
  ])
  return lastId()
}

function insertMember(name: string): number {
  db.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastId()
}

function insertProject(name: string): number {
  db.run(`INSERT INTO projects (name) VALUES (?)`, [name])
  return lastId()
}

function insertCounterparty(name: string): number {
  db.run(`INSERT INTO counterparties (name) VALUES (?)`, [name])
  return lastId()
}

function insertSettlementBatch(name: string): number {
  db.run(`INSERT INTO settlement_batches (name, type) VALUES (?, 'expense_splitting')`, [name])
  return lastId()
}

function insertGeneratedEntry(ruleId: number, dueDate: string): number {
  db.run(
    `INSERT INTO journal_entries (entry_date, source_type, generated_from_rule_id, recurring_due_date, household_member_id)
     VALUES (?, 'recurring_generated', ?, ?, ?)`,
    [dueDate, ruleId, dueDate, memberId],
  )
  return lastId()
}

function insertLine(entryId: number, accountId: number, side: 'debit' | 'credit', amount: number): void {
  db.run(
    `INSERT INTO journal_lines (journal_entry_id, account_id, side, amount, household_member_id) VALUES (?, ?, ?, ?, ?)`,
    [entryId, accountId, side, amount, memberId],
  )
}
