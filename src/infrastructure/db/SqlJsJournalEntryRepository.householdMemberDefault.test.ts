/**
 * SqlJsJournalEntryRepository の統合テスト(計画Issue #88)。
 * (1) journal_entries.household_member_id(起票者)がNOT NULLとして必須であること、
 * (2) 科目(accounts)に既定のhousehold_member_idが設定されている場合、その科目を使う
 * journal_linesの明細行では異なるhousehold_member_idを指定できないこと(DBトリガーレベル・
 * Repositoryレベルの双方、マニュアル起票・外部明細取込どちらの経路でも最終的に同じ
 * JournalEntryRepository.createを通るため単一の検証で両経路をカバーする、docs/architecture.md
 * 12章)を、docs/schema/journal.sqlのDDLトリガーに基づいて検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import type { CreateJournalEntryInput } from '../../domain/journal/JournalEntry'

let db: Database
let repository: SqlJsJournalEntryRepository
let husbandId: number
let wifeId: number
/** 既定の世帯メンバー(夫)が設定された普通預金口座 */
let bankAccountWithDefaultId: number
/** 既定値の無い現金口座 */
let cashAccountId: number
let foodExpenseAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsJournalEntryRepository(db)

  husbandId = insertHouseholdMember(db, '夫')
  wifeId = insertHouseholdMember(db, '妻')

  const accounts = new SqlJsAccountRepository(db)
  bankAccountWithDefaultId = accounts.create({
    category: 'asset',
    name: '普通預金',
    isReconcilable: true,
    householdMemberId: husbandId,
  }).id
  cashAccountId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodExpenseAccountId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
})

describe('起票者(journal_entries.household_member_id)の必須化', () => {
  it('householdMemberIdを指定せずに仕訳を作成しようとするとエラーになる', () => {
    const input = {
      entryDate: '2026-08-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit' as const, amount: 1000 },
        { accountId: cashAccountId, side: 'credit' as const, amount: 1000 },
      ],
    } as unknown as CreateJournalEntryInput

    expect(() => repository.create(input)).toThrow()
  })

  it('householdMemberIdを指定すれば起票者として保存される', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: wifeId,
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(created.householdMemberId).toBe(wifeId)
    expect(repository.findById(created.id)?.householdMemberId).toBe(wifeId)
  })
})

describe('科目既定値の強制(DBトリガーレベル): journal_linesへの直接INSERT/UPDATE', () => {
  it('科目に既定値がある行へ異なるhousehold_member_idをINSERTしようとすると拒否される', () => {
    const entryId = insertBareJournalEntry(db, husbandId)

    expect(() =>
      db.run(
        `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
         VALUES (?, ?, ?, 'debit', 1000)`,
        [entryId, bankAccountWithDefaultId, wifeId],
      ),
    ).toThrow()
  })

  it('科目に既定値が無い行へは自由にhousehold_member_idをINSERTできる', () => {
    const entryId = insertBareJournalEntry(db, husbandId)

    expect(() =>
      db.run(
        `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
         VALUES (?, ?, ?, 'debit', 1000)`,
        [entryId, cashAccountId, wifeId],
      ),
    ).not.toThrow()
  })

  it('科目の既定値と異なる値へのUPDATEも拒否される', () => {
    const entryId = insertBareJournalEntry(db, husbandId)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
       VALUES (?, ?, NULL, 'debit', 1000)`,
      [entryId, bankAccountWithDefaultId],
    )
    const lineId = lastInsertRowId(db)

    expect(() =>
      db.run(`UPDATE journal_lines SET household_member_id = ? WHERE id = ?`, [wifeId, lineId]),
    ).toThrow()
  })
})

describe('科目既定値の強制(Repositoryレベル): JournalEntryRepository.create/update', () => {
  it('科目に既定の世帯メンバーが設定された口座を使う明細で、異なる世帯メンバーを指定して作成しようとするとエラーになる', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-08-01',
        householdMemberId: husbandId,
        sourceType: 'initial_balance',
        lines: [
          { accountId: bankAccountWithDefaultId, householdMemberId: wifeId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()
    expect(repository.findAll()).toHaveLength(0)
  })

  it('科目に既定の世帯メンバーが設定された口座を使う明細で、同じ世帯メンバーを明示指定した場合は許可される', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: husbandId,
      sourceType: 'initial_balance',
      lines: [
        { accountId: bankAccountWithDefaultId, householdMemberId: husbandId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(created.lines.find((l) => l.accountId === bankAccountWithDefaultId)?.householdMemberId).toBe(
      husbandId,
    )
  })

  it('科目に既定の世帯メンバーが設定された口座を使う明細で、未指定(null)の場合は許可される', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: husbandId,
      sourceType: 'initial_balance',
      lines: [
        { accountId: bankAccountWithDefaultId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(
      created.lines.find((l) => l.accountId === bankAccountWithDefaultId)?.householdMemberId,
    ).toBeNull()
  })

  it('update()で科目の既定値と異なる世帯メンバーへ変更しようとするとエラーになる(外部明細取込の編集経路含む)', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: husbandId,
      sourceType: 'external_import',
      lines: [
        { accountId: bankAccountWithDefaultId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: created.entryDate,
        lines: [
          { accountId: bankAccountWithDefaultId, householdMemberId: wifeId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()
  })
})

function insertBareJournalEntry(database: Database, householdMemberId: number): number {
  database.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES (?, ?)`, [
    '2026-08-01',
    householdMemberId,
  ])
  return lastInsertRowId(database)
}

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}
