/**
 * SqlJsRecurringTransactionRuleRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/recurring-transactions.md・
 * docs/schema/recurring_transactions.sql に定義された定期仕訳ルールの作成・参照・更新・
 * 削除・非アクティブ化と、DDL側のトリガー(生成済み仕訳がある場合の物理削除禁止。is_reconcilable科目の
 * 直接指定禁止トリガーは計画Issue #145で廃止し、指定できることも検証する)・frequencyごとのカラム組み合わせCHECK制約が
 * 期待通り機能することを検証する。generated_from_rule_idのCOUNTで生成済み件数を
 * 算出するcountGeneratedJournalEntriesも検証する。提案の見送りの永続化・削除時の扱い(計画Issue #145)も
 * 検証する。計画Issue #164で追加した、開始日・終了日・間隔・土日の調整・金額の初期値の保存と既定値、
 * 再有効化(activate、再開日の記録、終了したルールの拒否)、生成済みの最新の期日(recurring_due_date、
 * entry_dateが編集されても動かない)、前回確定額、同じ期日の二重生成を防ぐ一意制約も検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'
import { InvalidRecurringScheduleError } from '../../domain/recurring-transaction/InvalidRecurringScheduleError'
import { twoLineRuleLines } from '../../domain/recurring-transaction/twoLineRuleLines'

let db: Database
let repository: SqlJsRecurringTransactionRuleRepository
let expenseAccountId: number
let liabilityAccountId: number
let reconcilableAssetAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsRecurringTransactionRuleRepository(db)
  expenseAccountId = insertAccount(db, 'expense', '通信費', null)
  liabilityAccountId = insertAccount(db, 'liability', '未払金', false)
  reconcilableAssetAccountId = insertAccount(db, 'asset', '普通預金', true)
})

describe('create / findById', () => {
  it('monthly(日付指定)のルールを作成する', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
      dayOfWeek: null,
      weekOfMonth: null,
      monthOfYear: null,
      maxOccurrences: null,
      isActive: true,
    })
  })

  it('weeklyのルールを作成する', () => {
    const created = repository.create({
      name: 'お小遣い',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 1000),
      frequency: 'weekly',
      dayOfWeek: 1,
    })

    expect(repository.findById(created.id)).toMatchObject({ frequency: 'weekly', dayOfWeek: 1 })
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('frequencyごとのカラム組み合わせに反する作成はassertValidRecurringScheduleにより拒否される', () => {
    expect(() =>
      repository.create({
        name: '不正なルール',
        lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 1000),
        frequency: 'weekly',
        dayOfWeek: 1,
        dayOfMonth: 15,
      }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('is_reconcilable=trueの科目を借方に指定してもルールを作成できる(計画Issue #145でトリガーを廃止)', () => {
    const created = repository.create({
      name: '口座への入金',
      lines: twoLineRuleLines(reconcilableAssetAccountId, liabilityAccountId, 1000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(repository.findById(created.id)?.lines[0].accountId).toBe(reconcilableAssetAccountId)
  })

  it('is_reconcilable=trueの科目を貸方に指定してもルールを作成できる(計画Issue #145でトリガーを廃止)', () => {
    const created = repository.create({
      name: '口座からの引き落とし',
      lines: twoLineRuleLines(expenseAccountId, reconcilableAssetAccountId, 1000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(repository.findById(created.id)?.lines[1].accountId).toBe(reconcilableAssetAccountId)
  })

  it('既存のルールの科目をis_reconcilable=trueの科目へ更新できる(計画Issue #145でトリガーを廃止)', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    const updated = repository.update(created.id, {
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, reconcilableAssetAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(updated.lines[1].accountId).toBe(reconcilableAssetAccountId)
  })
})

describe('findAll', () => {
  it('登録済みの全ルールをid順に返す', () => {
    const first = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    const second = repository.create({
      name: '給与',
      lines: twoLineRuleLines(liabilityAccountId, expenseAccountId, 300000),
      frequency: 'monthly',
      dayOfMonth: 25,
    })

    expect(repository.findAll().map((r) => r.id)).toEqual([first.id, second.id])
  })

  it('登録がない場合は空配列を返す', () => {
    expect(repository.findAll()).toEqual([])
  })
})

describe('update', () => {
  it('金額・スケジュールを変更する', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    const updated = repository.update(created.id, {
      name: '家賃(更新後)',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 85000),
      frequency: 'monthly',
      dayOfMonth: 5,
    })

    expect(updated).toMatchObject({ name: '家賃(更新後)', dayOfMonth: 5 })
    expect(updated.lines.map((l) => l.amount)).toEqual([85000, 85000])
  })

  it('存在しないidに対してはエラーをスローする', () => {
    expect(() =>
      repository.update(9999, {
        name: '存在しない',
        lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 1000),
        frequency: 'monthly',
        dayOfMonth: 1,
      }),
    ).toThrow()
  })

  it('frequencyごとのカラム組み合わせに反する更新はassertValidRecurringScheduleにより拒否される', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(() =>
      repository.update(created.id, {
        name: '家賃',
        lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
        frequency: 'yearly',
        dayOfMonth: 1,
        // monthOfYearが無いため yearly として不正
      }),
    ).toThrow(InvalidRecurringScheduleError)
  })
})

describe('delete', () => {
  it('生成済みの仕訳が無いルールは物理削除できる', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('生成済みの仕訳があるルールの物理削除はトリガーにより拒否される', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedJournalEntry(db, created.id)

    expect(() => repository.delete(created.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('is_activeをfalseにする(過去生成分には影響しない)', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
  })
})

describe('countGeneratedJournalEntries', () => {
  it('生成済みの仕訳が無ければ0を返す', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(repository.countGeneratedJournalEntries(created.id)).toBe(0)
  })

  it('generated_from_rule_idが一致する仕訳の件数を返す', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedJournalEntry(db, created.id, '2026-08-01')
    insertGeneratedJournalEntry(db, created.id, '2026-09-01')

    expect(repository.countGeneratedJournalEntries(created.id)).toBe(2)
  })
})

describe('findLatestGeneratedDueDate', () => {
  it('生成済みの仕訳が無ければnullを返す', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(repository.findLatestGeneratedDueDate(created.id)).toBeNull()
  })

  it('generated_from_rule_idが一致する仕訳のうち最新の期日(recurring_due_date)を返す', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedJournalEntry(db, created.id, '2026-07-01')
    insertGeneratedJournalEntry(db, created.id, '2026-09-01')
    insertGeneratedJournalEntry(db, created.id, '2026-08-01')

    expect(repository.findLatestGeneratedDueDate(created.id)).toBe('2026-09-01')
  })

  it('他ルールから生成された仕訳は対象外', () => {
    const created = repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    const otherRule = repository.create({
      name: '給与',
      lines: twoLineRuleLines(liabilityAccountId, expenseAccountId, 300000),
      frequency: 'monthly',
      dayOfMonth: 25,
    })
    insertGeneratedJournalEntry(db, otherRule.id, '2026-09-25')

    expect(repository.findLatestGeneratedDueDate(created.id)).toBeNull()
  })
})

describe('提案の見送り(recordSkip / findLatestSkippedDueDate、計画Issue #145)', () => {
  function createRule() {
    return repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
  }

  it('見送りが1件も無いルールは null を返す', () => {
    const rule = createRule()

    expect(repository.findLatestSkippedDueDate(rule.id)).toBeNull()
  })

  it('見送った対象日を記録でき、最新の対象日を返す', () => {
    const rule = createRule()

    repository.recordSkip(rule.id, '2026-07-01')
    repository.recordSkip(rule.id, '2026-08-01')

    expect(repository.findLatestSkippedDueDate(rule.id)).toBe('2026-08-01')
  })

  it('見送りはルールごとに独立している', () => {
    const rule = createRule()
    const other = createRule()

    repository.recordSkip(rule.id, '2026-07-01')

    expect(repository.findLatestSkippedDueDate(other.id)).toBeNull()
  })

  it('同じルール・同じ対象日を二重に見送ることはできない', () => {
    const rule = createRule()
    repository.recordSkip(rule.id, '2026-07-01')

    expect(() => repository.recordSkip(rule.id, '2026-07-01')).toThrow()
  })

  it('存在しないルールの見送りは記録できない(外部キー制約)', () => {
    expect(() => repository.recordSkip(9999, '2026-07-01')).toThrow()
  })

  it('見送りの記録は仕訳を作らず、生成済み件数にも数えない', () => {
    const rule = createRule()

    repository.recordSkip(rule.id, '2026-07-01')

    expect(repository.countGeneratedJournalEntries(rule.id)).toBe(0)
    expect(repository.findLatestGeneratedDueDate(rule.id)).toBeNull()
  })

  it('見送りだけがあるルールは物理削除でき、見送りの記録も一緒に削除される', () => {
    const rule = createRule()
    repository.recordSkip(rule.id, '2026-07-01')

    repository.delete(rule.id)

    expect(repository.findById(rule.id)).toBeNull()
    expect(db.exec('SELECT COUNT(*) FROM recurring_transaction_skips')[0].values[0][0]).toBe(0)
  })

  it('生成済みの仕訳があるルールは、見送りがあっても物理削除できない', () => {
    const rule = createRule()
    insertGeneratedJournalEntry(db, rule.id)
    repository.recordSkip(rule.id, '2026-09-01')

    expect(() => repository.delete(rule.id)).toThrow()
    expect(repository.findLatestSkippedDueDate(rule.id)).toBe('2026-09-01')
  })
})

function insertAccount(
  database: Database,
  category: string,
  name: string,
  isReconcilable: boolean | null,
): number {
  database.run(`INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, ?)`, [
    category,
    name,
    isReconcilable === null ? null : isReconcilable ? 1 : 0,
  ])
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

/** 生成済みの仕訳を1件挿入する。dueDateは土日の調整前の期日(recurring_due_date)、entryDateは省略時dueDateと同じ */
function insertGeneratedJournalEntry(
  database: Database,
  ruleId: number,
  dueDate = '2026-08-01',
  entryDate = dueDate,
): number {
  database.run(`INSERT INTO household_members (name) VALUES ('自分')`)
  const memberId = database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
  database.run(
    `INSERT INTO journal_entries
       (entry_date, source_type, generated_from_rule_id, recurring_due_date, household_member_id)
     VALUES (?, 'recurring_generated', ?, ?, ?)`,
    [entryDate, ruleId, dueDate, memberId],
  )
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

describe('スケジュールの拡張(計画Issue #164)', () => {
  const base = () => ({
    name: '家賃',
    lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
    frequency: 'monthly' as const,
    dayOfMonth: 25,
  })

  it('開始日・終了日・間隔・土日の調整・金額の初期値を省略すると、今日開始・終了なし・1回ごと・調整なし・固定になる', () => {
    const created = repository.create(base())

    expect(created).toMatchObject({
      endsOn: null,
      interval: 1,
      weekendAdjustment: 'none',
      amountMode: 'fixed',
      resumedOn: null,
    })
    expect(created.startsOn).toBe(new Date().toISOString().slice(0, 10))
  })

  it('開始日(過去日も可)・終了日・間隔・土日の調整・金額の初期値を指定して作成でき、更新もできる', () => {
    const created = repository.create({
      ...base(),
      startsOn: '2026-01-15',
      endsOn: '2026-12-31',
      interval: 3,
      weekendAdjustment: 'previous',
      amountMode: 'last_confirmed',
    })
    expect(created).toMatchObject({
      startsOn: '2026-01-15',
      endsOn: '2026-12-31',
      interval: 3,
      weekendAdjustment: 'previous',
      amountMode: 'last_confirmed',
    })

    const updated = repository.update(created.id, {
      ...base(),
      startsOn: '2026-02-01',
      endsOn: null,
      interval: 2,
      weekendAdjustment: 'next',
      amountMode: 'fixed',
    })
    expect(updated).toMatchObject({
      startsOn: '2026-02-01',
      endsOn: null,
      interval: 2,
      weekendAdjustment: 'next',
      amountMode: 'fixed',
    })
  })

  it('間隔が0以下・終了日が開始日より前の指定は拒否され、何も書き込まれない', () => {
    expect(() => repository.create({ ...base(), interval: 0 })).toThrow(InvalidRecurringScheduleError)
    expect(() => repository.create({ ...base(), startsOn: '2026-05-01', endsOn: '2026-04-30' })).toThrow(
      InvalidRecurringScheduleError,
    )
    expect(repository.findAll()).toEqual([])
  })

  it('更新しても再開日は変わらない(再開日は再有効化の操作でだけ決まる)', () => {
    const created = repository.create(base())
    repository.deactivate(created.id)
    repository.activate(created.id, '2026-03-01')

    const updated = repository.update(created.id, { ...base(), name: '家賃(改)' })

    expect(updated.resumedOn).toBe('2026-03-01')
  })
})

describe('activate(再有効化、計画Issue #164)', () => {
  const create = (overrides: Partial<Parameters<typeof repository.create>[0]> = {}) =>
    repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 25,
      startsOn: '2026-01-01',
      ...overrides,
    })

  it('無効なルールを有効に戻し、再開日を記録する(過去日も指定できる)', () => {
    const created = create()
    repository.deactivate(created.id)

    const activated = repository.activate(created.id, '2026-02-10')

    expect(activated.isActive).toBe(true)
    expect(activated.resumedOn).toBe('2026-02-10')
  })

  it('無効化と再有効化を繰り返すと、再開日は最後に選んだ日になる', () => {
    const created = create()
    repository.deactivate(created.id)
    repository.activate(created.id, '2026-02-10')
    repository.deactivate(created.id)

    const activated = repository.activate(created.id, '2026-05-20')

    expect(activated.resumedOn).toBe('2026-05-20')
  })

  it('生成済みの仕訳は変わらず、開始日も変わらない', () => {
    const created = create()
    insertGeneratedJournalEntry(db, created.id, '2026-01-25')
    repository.deactivate(created.id)

    const activated = repository.activate(created.id, '2026-02-10')

    expect(activated.startsOn).toBe('2026-01-01')
    expect(repository.countGeneratedJournalEntries(created.id)).toBe(1)
  })

  it('終了日を過ぎたルールは再有効化できない(終了日を編集して延ばす)', () => {
    const created = create({ endsOn: '2026-03-31' })
    repository.deactivate(created.id)

    expect(() => repository.activate(created.id, '2026-02-10', '2026-04-01')).toThrow()
    expect(repository.findById(created.id)!.isActive).toBe(false)
  })

  it('回数の上限に達したルールは再有効化できない', () => {
    const created = create({ maxOccurrences: 1 })
    insertGeneratedJournalEntry(db, created.id, '2026-01-25')
    repository.deactivate(created.id)

    expect(() => repository.activate(created.id, '2026-02-10')).toThrow()
  })

  it('存在しないルールの再有効化はエラーになる', () => {
    expect(() => repository.activate(9999, '2026-02-10')).toThrow()
  })
})

describe('findLatestGeneratedDueDate(期日の記録、計画Issue #164)', () => {
  const createRule = () =>
    repository.create({
      name: '家賃',
      lines: twoLineRuleLines(expenseAccountId, liabilityAccountId, 80000),
      frequency: 'monthly',
      dayOfMonth: 25,
    })

  it('仕訳のentry_dateが編集されても(土日の調整や手動の編集)、期日の最新は動かない', () => {
    const created = createRule()
    // 2026-01-25は日曜日。前平日調整で仕訳は1/23になるが、期日は1/25のまま
    const entryId = insertGeneratedJournalEntry(db, created.id, '2026-01-25', '2026-01-23')
    db.run('UPDATE journal_entries SET entry_date = ? WHERE id = ?', ['2025-12-01', entryId])

    expect(repository.findLatestGeneratedDueDate(created.id)).toBe('2026-01-25')
  })

  it('同じルール・同じ期日の仕訳は二重に作れない(DBの一意制約)', () => {
    const created = createRule()
    insertGeneratedJournalEntry(db, created.id, '2026-01-25')

    expect(() => insertGeneratedJournalEntry(db, created.id, '2026-01-25', '2026-01-24')).toThrow()
  })
})
