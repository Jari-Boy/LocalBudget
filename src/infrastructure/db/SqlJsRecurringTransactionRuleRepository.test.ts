/**
 * SqlJsRecurringTransactionRuleRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/recurring-transactions.md・
 * docs/schema/recurring_transactions.sql に定義された定期取引ルールの作成・参照・更新・
 * 削除・非アクティブ化と、DDL側のトリガー(is_reconcilable科目の直接指定禁止・
 * 生成済み仕訳がある場合の物理削除禁止)・frequencyごとのカラム組み合わせCHECK制約が
 * 期待通り機能することを検証する。generated_from_rule_idのCOUNTで生成済み件数を
 * 算出するcountGeneratedJournalEntriesも検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'
import { InvalidRecurringScheduleError } from '../../domain/recurring-transaction/InvalidRecurringScheduleError'

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
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
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
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 1000,
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
        debitAccountId: expenseAccountId,
        creditAccountId: liabilityAccountId,
        amount: 1000,
        frequency: 'weekly',
        dayOfWeek: 1,
        dayOfMonth: 15,
      }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('is_reconcilable=trueの科目を借方に指定した作成はトリガーにより拒否される', () => {
    expect(() =>
      repository.create({
        name: '不正なルール',
        debitAccountId: reconcilableAssetAccountId,
        creditAccountId: liabilityAccountId,
        amount: 1000,
        frequency: 'monthly',
        dayOfMonth: 1,
      }),
    ).toThrow()
  })

  it('is_reconcilable=trueの科目を貸方に指定した作成はトリガーにより拒否される', () => {
    expect(() =>
      repository.create({
        name: '不正なルール',
        debitAccountId: expenseAccountId,
        creditAccountId: reconcilableAssetAccountId,
        amount: 1000,
        frequency: 'monthly',
        dayOfMonth: 1,
      }),
    ).toThrow()
  })
})

describe('findAll', () => {
  it('登録済みの全ルールをid順に返す', () => {
    const first = repository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    const second = repository.create({
      name: '給与',
      debitAccountId: liabilityAccountId,
      creditAccountId: expenseAccountId,
      amount: 300000,
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
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    const updated = repository.update(created.id, {
      name: '家賃(更新後)',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 85000,
      frequency: 'monthly',
      dayOfMonth: 5,
    })

    expect(updated).toMatchObject({ name: '家賃(更新後)', amount: 85000, dayOfMonth: 5 })
  })

  it('存在しないidに対してはエラーをスローする', () => {
    expect(() =>
      repository.update(9999, {
        name: '存在しない',
        debitAccountId: expenseAccountId,
        creditAccountId: liabilityAccountId,
        amount: 1000,
        frequency: 'monthly',
        dayOfMonth: 1,
      }),
    ).toThrow()
  })

  it('frequencyごとのカラム組み合わせに反する更新はassertValidRecurringScheduleにより拒否される', () => {
    const created = repository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(() =>
      repository.update(created.id, {
        name: '家賃',
        debitAccountId: expenseAccountId,
        creditAccountId: liabilityAccountId,
        amount: 80000,
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
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('生成済みの仕訳があるルールの物理削除はトリガーにより拒否される', () => {
    const created = repository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
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
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
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
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })

    expect(repository.countGeneratedJournalEntries(created.id)).toBe(0)
  })

  it('generated_from_rule_idが一致する仕訳の件数を返す', () => {
    const created = repository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedJournalEntry(db, created.id)
    insertGeneratedJournalEntry(db, created.id)

    expect(repository.countGeneratedJournalEntries(created.id)).toBe(2)
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

function insertGeneratedJournalEntry(database: Database, ruleId: number): void {
  database.run(
    `INSERT INTO journal_entries (entry_date, source_type, generated_from_rule_id)
     VALUES ('2026-08-01', 'recurring_generated', ?)`,
    [ruleId],
  )
}
