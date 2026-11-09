/**
 * SqlJsJournalEntryRepository の統合テスト(計画Issue #88、#169)。
 * (1) journal_entries.household_member_id(起票者)がNOT NULLとして必須であること、
 * (2) journal_lines.household_member_idもNOT NULLで、世帯メンバーのない明細行は新規・更新とも
 * 保存できないこと(継承=NULLの廃止、計画Issue #169)、
 * (3) 科目(accounts)に既定のhousehold_member_idが設定されている場合、その科目を使う
 * journal_linesの明細行では、新規は既定値と異なる値を指定できず、更新はhousehold_member_idを
 * 変えない限り(科目の既定値を後から変えて旧メンバーのまま残した行でも)許可され、変える場合だけ
 * 既定値との一致を求められること(DBトリガーレベル・Repositoryレベルの双方、マニュアル起票・
 * 外部明細取込どちらの経路でも最終的に同じJournalEntryRepository.createを通るため単一の検証で
 * 両経路をカバーする、docs/architecture.md 12章)を、docs/schema/journal.sqlに基づいて検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import type { CreateJournalEntryInput, JournalLineInput } from '../../domain/journal/JournalEntry'

let db: Database
let repository: SqlJsJournalEntryRepository
let husbandId: number
let wifeId: number
let childId: number
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
  childId = insertHouseholdMember(db, '子')

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
        { accountId: foodExpenseAccountId, householdMemberId: wifeId, side: 'debit' as const, amount: 1000 },
        { accountId: cashAccountId, householdMemberId: wifeId, side: 'credit' as const, amount: 1000 },
      ],
    } as unknown as CreateJournalEntryInput

    expect(() => repository.create(input)).toThrow()
  })

  it('householdMemberIdを指定すれば起票者として保存される', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: wifeId,
      lines: [
        { accountId: foodExpenseAccountId, householdMemberId: wifeId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, householdMemberId: wifeId, side: 'credit', amount: 1000 },
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
    const lineId = insertLine(entryId, bankAccountWithDefaultId, husbandId)

    expect(() =>
      db.run(`UPDATE journal_lines SET household_member_id = ? WHERE id = ?`, [wifeId, lineId]),
    ).toThrow()
  })
})

describe('明細行の世帯メンバーの必須化(DBのNOT NULL): 計画Issue #169', () => {
  it('household_member_idがNULLの明細行はINSERTできない(科目に既定値が無い科目でも)', () => {
    const entryId = insertBareJournalEntry(db, husbandId)

    expect(() =>
      db.run(
        `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
         VALUES (?, ?, NULL, 'debit', 1000)`,
        [entryId, cashAccountId],
      ),
    ).toThrow()
  })

  it('household_member_idがNULLの明細行はINSERTできない(科目に既定値がある科目でも、継承はしない)', () => {
    const entryId = insertBareJournalEntry(db, husbandId)

    expect(() =>
      db.run(
        `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
         VALUES (?, ?, NULL, 'debit', 1000)`,
        [entryId, bankAccountWithDefaultId],
      ),
    ).toThrow()
  })

  it('既存の明細行のhousehold_member_idをNULLに更新することもできない', () => {
    const entryId = insertBareJournalEntry(db, husbandId)
    const lineId = insertLine(entryId, cashAccountId, wifeId)

    expect(() =>
      db.run(`UPDATE journal_lines SET household_member_id = NULL WHERE id = ?`, [lineId]),
    ).toThrow()
  })
})

describe('科目の既定値を後から変えて旧メンバーのまま残した行(UPDATEトリガ): 計画Issue #169', () => {
  /** 現金(既定値なし)に妻の行を作ったあと、現金の既定メンバーを夫に設定する */
  function lineKeptAsWifeUnderHusbandDefault(): number {
    const entryId = insertBareJournalEntry(db, husbandId)
    const lineId = insertLine(entryId, cashAccountId, wifeId)
    db.run(`UPDATE accounts SET household_member_id = ? WHERE id = ?`, [husbandId, cashAccountId])
    return lineId
  }

  it('household_member_idを変えない更新(金額の編集)は、旧メンバーのままでも保存できる', () => {
    const lineId = lineKeptAsWifeUnderHusbandDefault()

    expect(() => db.run(`UPDATE journal_lines SET amount = 2000 WHERE id = ?`, [lineId])).not.toThrow()
    expect(db.exec(`SELECT household_member_id, amount FROM journal_lines WHERE id = ${lineId}`)[0].values[0]).toEqual([
      wifeId,
      2000,
    ])
  })

  it('household_member_idを変える場合は、科目の既定値と同じ値にだけ変えられる', () => {
    const lineId = lineKeptAsWifeUnderHusbandDefault()

    expect(() =>
      db.run(`UPDATE journal_lines SET household_member_id = ? WHERE id = ?`, [childId, lineId]),
    ).toThrow()
    expect(() =>
      db.run(`UPDATE journal_lines SET household_member_id = ? WHERE id = ?`, [husbandId, lineId]),
    ).not.toThrow()
  })

  it('新規のINSERTは、旧メンバーのままの行があっても科目の既定値と異なる値を拒否する', () => {
    lineKeptAsWifeUnderHusbandDefault()
    const entryId = insertBareJournalEntry(db, husbandId)

    expect(() => insertLine(entryId, cashAccountId, wifeId)).toThrow()
    expect(() => insertLine(entryId, cashAccountId, husbandId)).not.toThrow()
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
          { accountId: foodExpenseAccountId, householdMemberId: husbandId, side: 'credit', amount: 1000 },
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
        { accountId: foodExpenseAccountId, householdMemberId: husbandId, side: 'credit', amount: 1000 },
      ],
    })

    expect(created.lines.find((l) => l.accountId === bankAccountWithDefaultId)?.householdMemberId).toBe(
      husbandId,
    )
  })

  it('世帯メンバーが未指定(null)の明細行を含む仕訳は、科目に既定値があっても作成できない(継承はしない)', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-08-01',
        householdMemberId: husbandId,
        sourceType: 'initial_balance',
        lines: [
          { accountId: bankAccountWithDefaultId, householdMemberId: null, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, householdMemberId: husbandId, side: 'credit', amount: 1000 },
        ] as unknown as JournalLineInput[],
      }),
    ).toThrow()
    expect(repository.findAll()).toHaveLength(0)
  })

  it('update()で明細行の世帯メンバーを未指定(null)にしようとするとエラーになる', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: husbandId,
      lines: [
        { accountId: foodExpenseAccountId, householdMemberId: wifeId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, householdMemberId: wifeId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: created.entryDate,
        lines: [
          { id: created.lines[0].id, accountId: foodExpenseAccountId, householdMemberId: null, side: 'debit', amount: 1000 },
          { id: created.lines[1].id, accountId: cashAccountId, householdMemberId: wifeId, side: 'credit', amount: 1000 },
        ] as unknown as JournalLineInput[],
      }),
    ).toThrow()
    expect(repository.findById(created.id)?.lines[0].householdMemberId).toBe(wifeId)
  })

  it('update()で、household_member_idを変えない編集は旧メンバーのまま残した行でも保存できる', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: husbandId,
      lines: [
        { accountId: foodExpenseAccountId, householdMemberId: wifeId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, householdMemberId: wifeId, side: 'credit', amount: 1000 },
      ],
    })
    db.run(`UPDATE accounts SET household_member_id = ? WHERE id = ?`, [husbandId, cashAccountId])

    const updated = repository.update(created.id, {
      entryDate: created.entryDate,
      lines: [
        { id: created.lines[0].id, accountId: foodExpenseAccountId, householdMemberId: wifeId, side: 'debit', amount: 1500 },
        { id: created.lines[1].id, accountId: cashAccountId, householdMemberId: wifeId, side: 'credit', amount: 1500 },
      ],
    })

    expect(updated.lines.map((l) => [l.amount, l.householdMemberId])).toEqual([
      [1500, wifeId],
      [1500, wifeId],
    ])
  })

  it('update()で科目の既定値と異なる世帯メンバーへ変更しようとするとエラーになる(外部明細取込の編集経路含む)', () => {
    const created = repository.create({
      entryDate: '2026-08-01',
      householdMemberId: husbandId,
      sourceType: 'external_import',
      lines: [
        { accountId: bankAccountWithDefaultId, householdMemberId: husbandId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, householdMemberId: husbandId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: created.entryDate,
        lines: [
          { accountId: bankAccountWithDefaultId, householdMemberId: wifeId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, householdMemberId: husbandId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()
  })
})

function insertLine(entryId: number, accountId: number, householdMemberId: number): number {
  db.run(
    `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
     VALUES (?, ?, ?, 'debit', 1000)`,
    [entryId, accountId, householdMemberId],
  )
  return lastInsertRowId(db)
}

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
