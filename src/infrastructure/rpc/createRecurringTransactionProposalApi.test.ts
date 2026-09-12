/**
 * createRecurringTransactionProposalApi(RPC層: 定期取引の提案評価・仕訳生成)の統合テスト。
 * listPendingがDBから都度読み直して再評価すること、confirmが科目区分の解決(counterparty_idの
 * PL側限定配置)・起票者の解決・仕訳生成(source_type=recurring_generated・
 * generated_from_rule_id設定)まで一貫して行うことを検証する。docs/domain/recurring-transactions.md
 * 1.2・1.4・2.1節。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import { createRecurringTransactionProposalApi } from './createRecurringTransactionProposalApi'

let db: Database
let api: ReturnType<typeof createRecurringTransactionProposalApi>
let ruleRepository: SqlJsRecurringTransactionRuleRepository
let expenseAccountId: number
let liabilityAccountId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  expenseAccountId = accounts.create({
    category: 'expense',
    name: '家賃',
    isReconcilable: null,
  }).id
  liabilityAccountId = accounts.create({
    category: 'liability',
    name: '未払金',
    isReconcilable: false,
  }).id
  ruleRepository = new SqlJsRecurringTransactionRuleRepository(db)
  api = createRecurringTransactionProposalApi(db, new SqlJsJournalEntryRepository(db))
})

afterEach(() => {
  vi.useRealTimers()
})

function insertGeneratedEntry(ruleId: number, entryDate: string): void {
  db.run(
    `INSERT INTO journal_entries (entry_date, source_type, generated_from_rule_id, household_member_id)
     VALUES (?, 'recurring_generated', ?, ?)`,
    [entryDate, ruleId, memberId],
  )
}

describe('listPending', () => {
  it('前回生成済みのentry_dateより後、現在日までの対象日を提案する', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-07-01')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T00:00:00Z'))

    expect(api.listPending()).toEqual([
      { ruleId: rule.id, dueDate: '2026-08-01' },
      { ruleId: rule.id, dueDate: '2026-09-01' },
    ])
  })

  it('非アクティブなルールは対象外(1.6節)', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-07-01')
    ruleRepository.deactivate(rule.id)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T00:00:00Z'))

    expect(api.listPending()).toEqual([])
  })
})

describe('confirm', () => {
  it('仕訳を生成し、source_type/generated_from_rule_id/entryDateを設定する', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    expect(entry.sourceType).toBe('recurring_generated')
    expect(entry.generatedFromRuleId).toBe(rule.id)
    expect(entry.entryDate).toBe('2026-09-01')
    expect(entry.lines.map((l) => l.amount)).toEqual([80000, 80000])
  })

  it('amountを指定すると、レビュー時の編集として上書きされる(2.1節)', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01', amount: 85000 })

    expect(entry.lines.map((l) => l.amount)).toEqual([85000, 85000])
  })

  it('counterparty_idはPL区分(expense)側の行にのみ設定される(1.4節、科目区分解決の結線を検証)', () => {
    const counterpartyId = new SqlJsCounterpartyRepository(db).create({ name: '不動産会社' }).id
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
      counterpartyId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    const debitLine = entry.lines.find((l) => l.side === 'debit')!
    const creditLine = entry.lines.find((l) => l.side === 'credit')!
    expect(debitLine.counterpartyId).toBe(counterpartyId)
    expect(creditLine.counterpartyId).toBeNull()
  })

  it('ルールにhouseholdMemberIdが無く、呼び出し側も指定しない場合はRecurringTransactionHouseholdMemberRequiredError', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })).toThrow(
      RecurringTransactionHouseholdMemberRequiredError,
    )
  })

  it('ルール側が未設定の場合、呼び出し側が指定したhouseholdMemberIdを起票者として使う', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({
      ruleId: rule.id,
      dueDate: '2026-09-01',
      householdMemberId: memberId,
    })

    expect(entry.householdMemberId).toBe(memberId)
  })

  it('既に処理済み(最新生成日以前)のdueDateを確認しようとするとエラーになる', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-09-01')

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })).toThrow()
  })

  it('存在しないruleIdを指定するとエラーになる', () => {
    expect(() => api.confirm({ ruleId: 9999, dueDate: '2026-09-01' })).toThrow()
  })

  it('スケジュールに合致しない日付を指定するとエラーになる(RPC境界の入力を無検証で信用しない)', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-09-15' })).toThrow()
  })

  it('未確認の対象日を飛び越えて後の対象日だけを確認すると、飛び越えた対象日が消失せずエラーになる(Review Attempt 1で再現・修正)', () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-01-01')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'))

    expect(api.listPending()).toEqual([
      { ruleId: rule.id, dueDate: '2026-02-01' },
      { ruleId: rule.id, dueDate: '2026-03-01' },
      { ruleId: rule.id, dueDate: '2026-04-01' },
    ])

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-04-01' })).toThrow()

    // 飛び越え確認は拒否され、2026-02-01・2026-03-01は依然として提案され続ける(消失しない)
    expect(api.listPending()).toEqual([
      { ruleId: rule.id, dueDate: '2026-02-01' },
      { ruleId: rule.id, dueDate: '2026-03-01' },
      { ruleId: rule.id, dueDate: '2026-04-01' },
    ])

    // 昇順に確認していけば、最終的に全て仕訳化できる
    api.confirm({ ruleId: rule.id, dueDate: '2026-02-01' })
    api.confirm({ ruleId: rule.id, dueDate: '2026-03-01' })
    api.confirm({ ruleId: rule.id, dueDate: '2026-04-01' })

    expect(api.listPending()).toEqual([])
  })
})
