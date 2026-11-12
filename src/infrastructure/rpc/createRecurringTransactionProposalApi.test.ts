/**
 * createRecurringTransactionProposalApi(RPC層: 定期仕訳の提案評価・仕訳生成)の統合テスト。
 * listPendingがDBから都度読み直して再評価すること、confirmが科目区分の解決(counterparty_idの
 * PL側限定配置)・起票者の解決・仕訳生成(source_type=recurring_generated・
 * generated_from_rule_id設定)まで一貫して行うことを検証する。提案の見送り(skip)が仕訳を作らず、
 * 古い順にしか行えず、再起動後も残ることも検証する(計画Issue #145)。docs/domain/recurring-transactions.md
 * 1.2・1.4・2.1節。計画Issue #164で追加した、確認パネルの摘要・コメントの保存(既定はルール名)、土日の調整
 * (調整後の日付がentry_date、調整前の期日がrecurring_due_dateに記録され、起点がずれない)、金額の初期値
 * (固定/前回確定額)、複数の提案のまとめて確定(古い順に途切れず選ぶ・全件成功か全件失敗・起票者の一括指定)
 * も検証する。外部依存: sql.js(ネットワークアクセスなし)。
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
import { twoLineRuleLines } from '../../domain/recurring-transaction/twoLineRuleLines'

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

/** 生成済みの仕訳を挿入する(期日・entry_dateとも同じ日付) */
function insertGeneratedEntry(ruleId: number, dueDate: string): void {
  db.run(
    `INSERT INTO journal_entries
       (entry_date, source_type, generated_from_rule_id, recurring_due_date, household_member_id)
     VALUES (?, 'recurring_generated', ?, ?, ?)`,
    [dueDate, ruleId, dueDate, memberId],
  )
}

/** 開始日の既定は「今日」で、固定した過去の日付を基準にするテストでは期日が出ないため、既定を過去にする */
function createRule(input: Parameters<SqlJsRecurringTransactionRuleRepository['create']>[0]) {
  return ruleRepository.create({ startsOn: '2026-01-01', ...input })
}

describe('listPending', () => {
  it('前回生成済みの期日より後、現在日までの対象日を提案する', () => {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-07-01')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T00:00:00Z'))

    expect(api.listPending()).toMatchObject([
      { ruleId: rule.id, dueDate: '2026-08-01' },
      { ruleId: rule.id, dueDate: '2026-09-01' },
    ])
  })

  it('非アクティブなルールは対象外(1.6節)', () => {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
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
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
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

  it('編集した行(linesを指定)で確定でき、科目・金額の変更、行の追加・削除ができる(計画Issue #180)', () => {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({
      ruleId: rule.id,
      dueDate: '2026-09-01',
      lines: [
        { accountId: expenseAccountId, side: 'debit', amount: 85000 },
        { accountId: expenseAccountId, side: 'debit', amount: 5000 },
        { accountId: liabilityAccountId, side: 'credit', amount: 90000 },
      ],
    })

    expect(entry.lines.map((l) => [l.accountId, l.side, l.amount])).toEqual([
      [expenseAccountId, 'debit', 85000],
      [expenseAccountId, 'debit', 5000],
      [liabilityAccountId, 'credit', 90000],
    ])
    expect(entry.generatedFromRuleId).toBe(rule.id)
    expect(entry.recurringDueDate).toBe('2026-09-01')
  })

  it('3行以上のルールを確定すると、ルールの全行を持つ仕訳ができる(計画Issue #180)', () => {
    const rule = createRule({
      name: '給与',
      lines: [
        { side: 'debit', accountId: liabilityAccountId, amount: 280000 },
        { side: 'debit', accountId: expenseAccountId, amount: 80000 },
        { side: 'credit', accountId: liabilityAccountId, amount: 360000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    expect(entry.lines.map((l) => [l.side, l.amount])).toEqual([
      ['debit', 280000],
      ['debit', 80000],
      ['credit', 360000],
    ])
  })

  it('行ごとの世帯メンバーは行に、起票者はルールに保存され、行で決まらない行は起票者になる(計画Issue #180)', () => {
    const otherMemberId = new SqlJsHouseholdMemberRepository(db).create({ name: '配偶者' }).id
    const rule = createRule({
      name: '家賃',
      bookkeeperHouseholdMemberId: memberId,
      lines: [
        { side: 'debit', accountId: expenseAccountId, amount: 80000, householdMemberId: otherMemberId },
        { side: 'credit', accountId: liabilityAccountId, amount: 80000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    expect(entry.householdMemberId).toBe(memberId)
    expect(entry.lines.map((l) => l.householdMemberId)).toEqual([otherMemberId, memberId])
  })

  it('ルールの行の精算バッチのタグが、生成した仕訳の行に付く(計画Issue #180)', () => {
    db.run(
      `INSERT INTO accounts (category, name, is_reconcilable, is_system_managed) VALUES ('asset', '立替金テスト', 0, 1)`,
    )
    const advanceId = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    db.run(`INSERT INTO settlement_batches (name, type) VALUES ('旅行2026', 'expense_splitting')`)
    const batchId = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    const rule = createRule({
      name: '立替',
      bookkeeperHouseholdMemberId: memberId,
      lines: [
        { side: 'debit', accountId: advanceId, amount: 1000, settlementBatchId: batchId },
        { side: 'credit', accountId: liabilityAccountId, amount: 1000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    expect(entry.lines.map((l) => l.settlementBatchId)).toEqual([batchId, null])
  })

  it('counterparty_idはPL区分(expense)側の行にのみ設定される(1.4節、科目区分解決の結線を検証)', () => {
    const counterpartyId = new SqlJsCounterpartyRepository(db).create({ name: '不動産会社' }).id
    const rule = createRule({
      name: '家賃',
      lines: [
        { side: 'debit', accountId: expenseAccountId, amount: 80000, counterpartyId },
        { side: 'credit', accountId: liabilityAccountId, amount: 80000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
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
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
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
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
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
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-09-01')

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })).toThrow()
  })

  it('存在しないruleIdを指定するとエラーになる', () => {
    expect(() => api.confirm({ ruleId: 9999, dueDate: '2026-09-01' })).toThrow()
  })

  it('スケジュールに合致しない日付を指定するとエラーになる(RPC境界の入力を無検証で信用しない)', () => {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-09-15' })).toThrow()
  })

  it('未確認の対象日を飛び越えて後の対象日だけを確認すると、飛び越えた対象日が消失せずエラーになる(Review Attempt 1で再現・修正)', () => {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-01-01')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'))

    expect(api.listPending()).toMatchObject([
      { ruleId: rule.id, dueDate: '2026-02-01' },
      { ruleId: rule.id, dueDate: '2026-03-01' },
      { ruleId: rule.id, dueDate: '2026-04-01' },
    ])

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-04-01' })).toThrow()

    // 飛び越え確認は拒否され、2026-02-01・2026-03-01は依然として提案され続ける(消失しない)
    expect(api.listPending()).toMatchObject([
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

describe('skip(提案の見送り、計画Issue #145)', () => {
  function createMonthlyRule(overrides: { maxOccurrences?: number } = {}) {
    return createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
      ...overrides,
    })
  }

  function setNow(iso: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('見送ると仕訳は作られず、その対象日は未処理の提案から消え、次の提案を確定できる', () => {
    const rule = createMonthlyRule()
    insertGeneratedEntry(rule.id, '2026-06-01')
    setNow('2026-09-25T00:00:00Z')

    api.skip({ ruleId: rule.id, dueDate: '2026-07-01' })

    expect(api.listPending()).toMatchObject([
      { ruleId: rule.id, dueDate: '2026-08-01' },
      { ruleId: rule.id, dueDate: '2026-09-01' },
    ])
    expect(ruleRepository.countGeneratedJournalEntries(rule.id)).toBe(1)
    const confirmed = api.confirm({ ruleId: rule.id, dueDate: '2026-08-01' })
    expect(confirmed.entryDate).toBe('2026-08-01')
  })

  it('見送った提案は、APIを作り直した(再起動した)あとも再び出ない', () => {
    const rule = createMonthlyRule()
    insertGeneratedEntry(rule.id, '2026-06-01')
    setNow('2026-08-25T00:00:00Z')
    api.skip({ ruleId: rule.id, dueDate: '2026-07-01' })

    const restartedApi = createRecurringTransactionProposalApi(db, new SqlJsJournalEntryRepository(db))

    expect(restartedApi.listPending()).toMatchObject([{ ruleId: rule.id, dueDate: '2026-08-01' }])
  })

  it('古い提案を飛ばして見送ることはできず、何も記録されない', () => {
    const rule = createMonthlyRule()
    insertGeneratedEntry(rule.id, '2026-06-01')
    setNow('2026-09-25T00:00:00Z')

    expect(() => api.skip({ ruleId: rule.id, dueDate: '2026-08-01' })).toThrow()

    expect(ruleRepository.findLatestSkippedDueDate(rule.id)).toBeNull()
    expect(api.listPending()[0]).toMatchObject({ ruleId: rule.id, dueDate: '2026-07-01' })
  })

  it('確定と見送りが混ざっても、未処理の提案が正しく導出される', () => {
    const rule = createMonthlyRule()
    insertGeneratedEntry(rule.id, '2026-05-01')
    setNow('2026-09-25T00:00:00Z')

    api.skip({ ruleId: rule.id, dueDate: '2026-06-01' })
    api.confirm({ ruleId: rule.id, dueDate: '2026-07-01' })
    api.skip({ ruleId: rule.id, dueDate: '2026-08-01' })

    expect(api.listPending()).toMatchObject([{ ruleId: rule.id, dueDate: '2026-09-01' }])
  })

  it('スケジュールに合致しない日付・存在しないルール・未処理の提案が無い場合はエラーになる', () => {
    const rule = createMonthlyRule()
    insertGeneratedEntry(rule.id, '2026-06-01')
    setNow('2026-07-25T00:00:00Z')

    expect(() => api.skip({ ruleId: rule.id, dueDate: '2026-07-15' })).toThrow()
    expect(() => api.skip({ ruleId: 9999, dueDate: '2026-07-01' })).toThrow()
    api.skip({ ruleId: rule.id, dueDate: '2026-07-01' })
    expect(() => api.skip({ ruleId: rule.id, dueDate: '2026-07-01' })).toThrow()
  })

  it('見送りは回数に数えず、見送ってもルール自体は無効にならない(max_occurrencesの終わりが後ろへずれる)', () => {
    const rule = createMonthlyRule({ maxOccurrences: 2 })
    insertGeneratedEntry(rule.id, '2026-06-01')
    setNow('2026-12-25T00:00:00Z')

    api.skip({ ruleId: rule.id, dueDate: '2026-07-01' })

    expect(ruleRepository.findById(rule.id)?.isActive).toBe(true)
    // 生成済み1件・上限2件なので、見送った回を数えずに、あと1回だけ提案される
    expect(api.listPending()).toMatchObject([{ ruleId: rule.id, dueDate: '2026-08-01' }])
  })
})

describe('確認パネルの摘要・コメント(計画Issue #164)', () => {
  function setup() {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    return rule
  }

  it('摘要とコメントを渡すと、確定した仕訳に保存される', () => {
    const rule = setup()

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01', memo: '家賃 9月分', comment: '更新料は別途' })

    expect(entry).toMatchObject({ memo: '家賃 9月分', comment: '更新料は別途' })
  })

  it('摘要を渡さないと、ルール名が摘要になる(仕訳一覧で「(摘要なし)」にならない)', () => {
    const rule = setup()

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    expect(entry.memo).toBe('家賃')
    expect(entry.comment).toBeNull()
  })
})

describe('土日の調整と期日の記録(計画Issue #164)', () => {
  /** 毎月25日・前平日調整。2026-01-25は日曜日、2026-02-25は水曜日 */
  function setup() {
    const rule = createRule({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 25,
      weekendAdjustment: 'previous',
      startsOn: '2026-01-01',
      bookkeeperHouseholdMemberId: memberId,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-25T00:00:00Z'))
    return rule
  }

  it('提案は調整前の期日を持ち、調整後の日付(entryDate)も返す', () => {
    const rule = setup()

    expect(api.listPending()).toMatchObject([
      { ruleId: rule.id, dueDate: '2026-01-25', entryDate: '2026-01-23', defaultAmount: 80000 },
      { ruleId: rule.id, dueDate: '2026-02-25', entryDate: '2026-02-25', defaultAmount: 80000 },
    ])
  })

  it('確定すると、調整後の日付が仕訳のentry_dateに、調整前の期日がrecurring_due_dateに記録される', () => {
    const rule = setup()

    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-01-25' })

    expect(entry).toMatchObject({ entryDate: '2026-01-23', recurringDueDate: '2026-01-25' })
  })

  it('前平日調整で確定したあとも、同じ期日(1/25)が再提案されない', () => {
    const rule = setup()
    api.confirm({ ruleId: rule.id, dueDate: '2026-01-25' })

    expect(api.listPending().map((p) => p.dueDate)).toEqual(['2026-02-25'])
  })

  it('生成した仕訳の日付をあとから編集しても、提案の起点がずれない', () => {
    const rule = setup()
    const entry = api.confirm({ ruleId: rule.id, dueDate: '2026-01-25' })
    db.run('UPDATE journal_entries SET entry_date = ? WHERE id = ?', ['2025-11-01', entry.id])

    expect(api.listPending().map((p) => p.dueDate)).toEqual(['2026-02-25'])
  })

  it('同じ期日をもう一度確定することはできない', () => {
    const rule = setup()
    api.confirm({ ruleId: rule.id, dueDate: '2026-01-25' })

    expect(() => api.confirm({ ruleId: rule.id, dueDate: '2026-01-25' })).toThrow()
  })

  it('見送りは調整前の期日で記録される', () => {
    const rule = setup()

    api.skip({ ruleId: rule.id, dueDate: '2026-01-25' })

    expect(ruleRepository.findLatestSkippedDueDate(rule.id)).toBe('2026-01-25')
    expect(api.listPending().map((p) => p.dueDate)).toEqual(['2026-02-25'])
  })
})

describe('金額の初期値(amount_mode、計画Issue #164・#180)', () => {
  const lines = (amount: number) => [
    { accountId: expenseAccountId, side: 'debit' as const, amount },
    { accountId: liabilityAccountId, side: 'credit' as const, amount },
  ]

  function setup(amountMode: 'fixed' | 'last_confirmed') {
    const rule = createRule({
      name: '電気代',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 8000),
      frequency: 'monthly',
      dayOfMonth: 10,
      amountMode,
      bookkeeperHouseholdMemberId: memberId,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'))
    return rule
  }

  it('fixed: 初期値は常にルールの金額', () => {
    const rule = setup('fixed')
    api.confirm({ ruleId: rule.id, dueDate: '2026-01-10', lines: lines(9100) })

    expect(api.listPending()[0].defaultAmount).toBe(8000)
  })

  it('last_confirmed: 前回確定した仕訳が無ければ、初期値はルールの金額', () => {
    setup('last_confirmed')

    expect(api.listPending()[0].defaultAmount).toBe(8000)
  })

  it('last_confirmed: 前回確定した金額が次の提案の初期値になり、金額を省略した確定にも使われる', () => {
    const rule = setup('last_confirmed')
    api.confirm({ ruleId: rule.id, dueDate: '2026-01-10', lines: lines(9100) })

    expect(api.listPending()[0]).toMatchObject({ dueDate: '2026-02-10', defaultAmount: 9100 })
    const next = api.confirm({ ruleId: rule.id, dueDate: '2026-02-10' })
    expect(next.lines.map((l) => l.amount)).toEqual([9100, 9100])
  })

  it('last_confirmed: 科目と借方/貸方が一致する行だけ前回額を引き継ぎ、一致しない行はルールの金額を使う(計画Issue #180)', () => {
    const rule = createRule({
      name: '電気代',
      lines: [
        { side: 'debit', accountId: expenseAccountId, amount: 8000 },
        { side: 'credit', accountId: liabilityAccountId, amount: 8000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 10,
      amountMode: 'last_confirmed',
      bookkeeperHouseholdMemberId: memberId,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'))
    // 前回は1回だけ手で行を足し、金額も変えて確定した(足した行は次回に紛れ込まない)
    api.confirm({
      ruleId: rule.id,
      dueDate: '2026-01-10',
      lines: [
        { accountId: expenseAccountId, side: 'debit', amount: 9100 },
        { accountId: expenseAccountId, side: 'debit', amount: 300 },
        { accountId: liabilityAccountId, side: 'credit', amount: 9400 },
      ],
    })

    const [pending] = api.listPending()

    expect(pending.defaultLines.map((l) => [l.lineNo, l.side, l.amount])).toEqual([
      [1, 'debit', 9100],
      [2, 'credit', 9400],
    ])
  })
})

describe('confirmMany(まとめて確定、計画Issue #164)', () => {
  function createMonthlyRule(name: string, overrides: { householdMemberId?: number | null; amountMode?: 'fixed' | 'last_confirmed'; amount?: number } = {}) {
    return createRule({
      name,
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, overrides.amount ?? 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      startsOn: '2026-07-01',
      bookkeeperHouseholdMemberId: overrides.householdMemberId === undefined ? memberId : overrides.householdMemberId,
      amountMode: overrides.amountMode,
    })
  }

  function setNow(iso: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('選んだ複数の提案(複数のルールにまたがる)を、金額の初期値・摘要の既定(ルール名)のまままとめて確定する', () => {
    const rent = createMonthlyRule('家賃')
    const net = createMonthlyRule('通信費', { amount: 5000 })
    setNow('2026-09-01T00:00:00Z')

    const entries = api.confirmMany({
      items: [
        { ruleId: rent.id, dueDate: '2026-07-01' },
        { ruleId: rent.id, dueDate: '2026-08-01' },
        { ruleId: net.id, dueDate: '2026-07-01' },
      ],
    })

    expect(entries.map((e) => [e.memo, e.recurringDueDate])).toEqual([
      ['家賃', '2026-07-01'],
      ['家賃', '2026-08-01'],
      ['通信費', '2026-07-01'],
    ])
    expect(api.listPending().map((p) => `${p.ruleId}:${p.dueDate}`)).toEqual([
      `${rent.id}:2026-09-01`,
      `${net.id}:2026-08-01`,
      `${net.id}:2026-09-01`,
    ])
  })

  it('入力の順序によらず、同じルールは古い期日から確定される', () => {
    const rule = createMonthlyRule('家賃')
    setNow('2026-09-01T00:00:00Z')

    const entries = api.confirmMany({
      items: [
        { ruleId: rule.id, dueDate: '2026-08-01' },
        { ruleId: rule.id, dueDate: '2026-07-01' },
      ],
    })

    expect(entries.map((e) => e.recurringDueDate)).toEqual(['2026-07-01', '2026-08-01'])
  })

  it('last_confirmedのルールは、前回確定額ではなく選択時点の初期値で確定する(2件目以降は直前の確定額に追従しない)', () => {
    const rule = createMonthlyRule('電気代', { amountMode: 'last_confirmed', amount: 8000 })
    setNow('2026-09-01T00:00:00Z')
    api.confirm({
      ruleId: rule.id,
      dueDate: '2026-07-01',
      lines: [
        { accountId: expenseAccountId, side: 'debit', amount: 9100 },
        { accountId: liabilityAccountId, side: 'credit', amount: 9100 },
      ],
    })

    const entries = api.confirmMany({
      items: [
        { ruleId: rule.id, dueDate: '2026-08-01' },
        { ruleId: rule.id, dueDate: '2026-09-01' },
      ],
    })

    expect(entries.map((e) => e.lines[0].amount)).toEqual([9100, 9100])
  })

  it('同じルールの古い提案を飛ばした選び方は拒否され、1件も確定されない', () => {
    const rule = createMonthlyRule('家賃')
    setNow('2026-09-01T00:00:00Z')

    expect(() =>
      api.confirmMany({
        items: [
          { ruleId: rule.id, dueDate: '2026-08-01' },
          { ruleId: rule.id, dueDate: '2026-09-01' },
        ],
      }),
    ).toThrow()

    expect(ruleRepository.countGeneratedJournalEntries(rule.id)).toBe(0)
  })

  it('起票者が未定のルールが含まれ、起票者を指定しなければ、1件も確定されない(他のルールの分も)', () => {
    const decided = createMonthlyRule('家賃')
    const undecided = createMonthlyRule('塾の月謝', { householdMemberId: null })
    setNow('2026-07-01T00:00:00Z')

    expect(() =>
      api.confirmMany({
        items: [
          { ruleId: decided.id, dueDate: '2026-07-01' },
          { ruleId: undecided.id, dueDate: '2026-07-01' },
        ],
      }),
    ).toThrow(RecurringTransactionHouseholdMemberRequiredError)

    expect(ruleRepository.countGeneratedJournalEntries(decided.id)).toBe(0)
    expect(ruleRepository.countGeneratedJournalEntries(undecided.id)).toBe(0)
  })

  it('起票者が未定のルールが含まれても、まとめて1人を指定すれば確定できる(起票者が決まっているルールには影響しない)', () => {
    const otherMemberId = new SqlJsHouseholdMemberRepository(db).create({ name: '家族' }).id
    const decided = createMonthlyRule('家賃')
    const undecided = createMonthlyRule('塾の月謝', { householdMemberId: null })
    setNow('2026-07-01T00:00:00Z')

    const entries = api.confirmMany({
      items: [
        { ruleId: decided.id, dueDate: '2026-07-01' },
        { ruleId: undecided.id, dueDate: '2026-07-01' },
      ],
      householdMemberId: otherMemberId,
    })

    expect(entries.map((e) => e.householdMemberId)).toEqual([memberId, otherMemberId])
  })

  it('途中で失敗した場合(存在しないルール)、それまでの分も含めて1件も確定されない', () => {
    const rule = createMonthlyRule('家賃')
    setNow('2026-09-01T00:00:00Z')

    expect(() =>
      api.confirmMany({
        items: [
          { ruleId: rule.id, dueDate: '2026-07-01' },
          { ruleId: 9999, dueDate: '2026-07-01' },
        ],
      }),
    ).toThrow()

    expect(ruleRepository.countGeneratedJournalEntries(rule.id)).toBe(0)
  })

  it('空の選択は何もせず、空配列を返す', () => {
    expect(api.confirmMany({ items: [] })).toEqual([])
  })

  it('同じ提案を重複して選ぶとエラーになり、1件も確定されない', () => {
    const rule = createMonthlyRule('家賃')
    setNow('2026-09-01T00:00:00Z')

    expect(() =>
      api.confirmMany({
        items: [
          { ruleId: rule.id, dueDate: '2026-07-01' },
          { ruleId: rule.id, dueDate: '2026-07-01' },
        ],
      }),
    ).toThrow()
    expect(ruleRepository.countGeneratedJournalEntries(rule.id)).toBe(0)
  })
})
