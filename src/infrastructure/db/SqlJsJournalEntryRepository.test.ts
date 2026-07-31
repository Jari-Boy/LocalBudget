/**
 * SqlJsJournalEntryRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md・docs/schema/journal.sql
 * に定義された仕訳(JournalEntry)・仕訳明細(JournalLine)の作成・参照・更新(明細行の全差し替え)・
 * 削除(物理削除)、貸借バランス検証(不一致時は書き込まずUnbalancedJournalEntryErrorを投げる)、
 * FK制約有効化によるDB側エラー時のロールバック保証を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'

let db: Database
let repository: SqlJsJournalEntryRepository
let cashAccountId: number
let foodExpenseAccountId: number
let miscExpenseAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)

  cashAccountId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodExpenseAccountId = accounts.create({
    category: 'expense',
    name: '食費',
    isReconcilable: null,
  }).id
  miscExpenseAccountId = accounts.create({
    category: 'expense',
    name: '日用品費',
    isReconcilable: null,
  }).id
})

describe('create / findById', () => {
  it('creates a balanced journal entry with header and lines and reads it back by id', () => {
    const created = repository.create({
      entryDate: '2026-07-20',
      memo: 'スーパーで食材購入',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    const found = repository.findById(created.id)

    expect(found?.entryDate).toBe('2026-07-20')
    expect(found?.memo).toBe('スーパーで食材購入')
    expect(found?.currency).toBe('JPY')
    expect(found?.sourceType).toBe('manual')
    expect(found?.lines).toHaveLength(2)
    expect(
      found?.lines.map((l) => ({ accountId: l.accountId, side: l.side, amount: l.amount })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ]),
    )
  })

  it('returns null for an id that does not exist', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('creates a compound entry split across multiple expense accounts', () => {
    const created = repository.create({
      entryDate: '2026-07-21',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 7000 },
        { accountId: miscExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 10000 },
      ],
    })

    expect(repository.findById(created.id)?.lines).toHaveLength(3)
  })

  it('round-trips optional projectId/householdMemberId/counterpartyId on a line', () => {
    const memberId = insertHouseholdMember(db, '夫')
    const projectId = insertProject(db, '旅行2026')
    const revenueAccountId = new SqlJsAccountRepository(db).create({
      category: 'revenue',
      name: '副業収入',
      isReconcilable: null,
    }).id
    const counterpartyId = insertCounterparty(db, '取引先A')

    const created = repository.create({
      entryDate: '2026-07-23',
      lines: [
        { accountId: cashAccountId, side: 'debit', amount: 5000 },
        {
          accountId: revenueAccountId,
          side: 'credit',
          amount: 5000,
          projectId,
          householdMemberId: memberId,
          counterpartyId,
        },
      ],
    })

    const creditLine = repository
      .findById(created.id)
      ?.lines.find((l) => l.side === 'credit')

    expect(creditLine).toMatchObject({
      accountId: revenueAccountId,
      projectId,
      householdMemberId: memberId,
      counterpartyId,
    })
  })
})

describe('貸借バランス検証', () => {
  it('throws UnbalancedJournalEntryError and writes nothing when creating an unbalanced entry', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-22',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
          { accountId: cashAccountId, side: 'credit', amount: 2000 },
        ],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('throws UnbalancedJournalEntryError and leaves the original lines untouched when updating to an unbalanced set', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-22',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 5000 },
          { accountId: cashAccountId, side: 'credit', amount: 3000 },
        ],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    const stillOriginal = repository.findById(created.id)
    expect(stillOriginal?.lines).toHaveLength(2)
    expect(
      stillOriginal?.lines.find((l) => l.accountId === foodExpenseAccountId)?.amount,
    ).toBe(3000)
  })

  it('throws UnbalancedJournalEntryError and writes nothing when creating with zero lines (journal.md 1.1: 2件以上の不変条件)', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-27',
        lines: [],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
  })

  it('throws UnbalancedJournalEntryError and writes nothing when creating with only one line (journal.md 1.1: 2件以上の不変条件)', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-27',
        lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('throws UnbalancedJournalEntryError and leaves the original lines untouched when updating to zero lines', () => {
    const created = repository.create({
      entryDate: '2026-07-28',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1500 },
        { accountId: cashAccountId, side: 'credit', amount: 1500 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-28',
        lines: [],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findById(created.id)?.lines).toHaveLength(2)
  })
})

describe('findAll', () => {
  it('returns every created journal entry', () => {
    repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    repository.create({
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: cashAccountId, side: 'credit', amount: 2000 },
      ],
    })

    expect(repository.findAll()).toHaveLength(2)
  })
})

describe('update(明細行の全差し替え)', () => {
  it('replaces all lines and updates journal_entries.updated_at', () => {
    const created = repository.create({
      entryDate: '2026-07-10',
      memo: '当初の内容',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    // 更新によってupdated_atが変わることを、時計を待たずに確認するため
    // 固定の過去日時を直接セットしておく
    db.run(`UPDATE journal_entries SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [
      created.id,
    ])

    const updated = repository.update(created.id, {
      entryDate: '2026-07-11',
      memo: '差し替え後の内容',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 4000 },
        { accountId: cashAccountId, side: 'credit', amount: 4000 },
      ],
    })

    expect(updated.entryDate).toBe('2026-07-11')
    expect(updated.memo).toBe('差し替え後の内容')
    expect(updated.lines).toHaveLength(2)
    expect(updated.lines.map((l) => l.accountId)).toEqual(
      expect.arrayContaining([miscExpenseAccountId, cashAccountId]),
    )
    expect(updated.lines.some((l) => l.accountId === foodExpenseAccountId)).toBe(false)
    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })

  it('replaces the old journal_lines rows with newly-inserted ones (line ids are not preserved across an update)', () => {
    const created = repository.create({
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    // journal_linesテーブルが更新対象の仕訳の行だけで完全に空にならないよう、
    // 他の仕訳もあらかじめ作成しておく(SQLiteはINTEGER PRIMARY KEYがAUTOINCREMENTでない場合、
    // テーブルが完全に空になると採番を1から再開するため、他の行が存在しない状態だと
    // 偶然idが一致してしまい、この検証の意図が成立しない)
    repository.create({
      entryDate: '2026-07-13',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: cashAccountId, side: 'credit', amount: 500 },
      ],
    })
    const originalLineIds = created.lines.map((l) => l.id).sort()

    const updated = repository.update(created.id, {
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const newLineIds = updated.lines.map((l) => l.id).sort()

    expect(newLineIds).not.toEqual(originalLineIds)
    for (const id of originalLineIds) {
      expect(newLineIds).not.toContain(id)
    }
  })
})

describe('DB制約違反時のロールバック(FK制約有効化)', () => {
  it('rolls back the entire transaction when creating with a line that references a non-existent account', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-25',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
          { accountId: 999999, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('rolls back the entire transaction when updating with a line that references a non-existent account', () => {
    const created = repository.create({
      entryDate: '2026-07-26',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: cashAccountId, side: 'credit', amount: 2000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-26',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 2000 },
          { accountId: 999999, side: 'credit', amount: 2000 },
        ],
      }),
    ).toThrow()

    const stillOriginal = repository.findById(created.id)
    expect(stillOriginal?.lines).toHaveLength(2)
    expect(stillOriginal?.lines.every((l) => l.accountId !== 999999)).toBe(true)
  })
})

describe('delete', () => {
  it('physically deletes a journal entry and cascades its lines', () => {
    const created = repository.create({
      entryDate: '2026-07-05',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: cashAccountId, side: 'credit', amount: 500 },
      ],
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
    expect(countJournalLines(db)).toBe(0)
  })

  it('always allows deleting an external_import entry', () => {
    const created = repository.create({
      entryDate: '2026-07-06',
      sourceType: 'external_import',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 800 },
        { accountId: cashAccountId, side: 'credit', amount: 800 },
      ],
    })

    expect(() => repository.delete(created.id)).not.toThrow()
    expect(repository.findById(created.id)).toBeNull()
  })
})

function countJournalLines(database: Database): number {
  return database.exec('SELECT COUNT(*) AS c FROM journal_lines')[0].values[0][0] as number
}

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function insertProject(database: Database, name: string): number {
  database.run(`INSERT INTO projects (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function insertCounterparty(database: Database, name: string): number {
  database.run(`INSERT INTO counterparties (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}
