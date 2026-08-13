/**
 * SqlJsCounterpartyRepository の統合(merge)機能の統合テスト。
 * docs/domain/counterparties.md 1.5aに定義された、複数の取引先(統合元)を1取引先(統合先)へ
 * 集約する操作(journal_lines・counterparty_patternsの付け替え、counterparty_merge_logへの
 * 記録)が期待通り機能することを検証する。
 * 基本CRUDは SqlJsCounterpartyRepository.test.ts、パターン管理は
 * SqlJsCounterpartyRepository.pattern.test.ts で扱う。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'

let db: Database
let repository: SqlJsCounterpartyRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsCounterpartyRepository(db)
})

describe('merge', () => {
  it('統合元に紐づくjournal_lines.counterparty_idを統合先へ付け替える', () => {
    const target = repository.create({ name: 'ローソン' })
    const source = repository.create({ name: 'ローソン 東京日本橋店' })
    const accountId = insertAccount(db, 'expense', '食費')
    const entryId = insertJournalEntry(db)
    const lineId = insertJournalLine(db, entryId, accountId, source.id)

    repository.merge(target.id, [source.id])

    const counterpartyId = queryCounterpartyIdOfLine(db, lineId)
    expect(counterpartyId).toBe(target.id)
  })

  it('統合元に紐づくcounterparty_patternsを統合先へ付け替える', () => {
    const target = repository.create({ name: 'ローソン' })
    const source = repository.create({ name: 'ローソン 東京日本橋店' })
    repository.addPattern(source.id, 'LAWSON NIHONBASHI')

    repository.merge(target.id, [source.id])

    const matches = repository.findByPattern('LAWSON NIHONBASHI TEN')
    expect(matches).toHaveLength(1)
    expect(matches[0].counterpartyId).toBe(target.id)
  })

  it('統合元→統合先のペアごとにcounterparty_merge_logへ1行記録する', () => {
    const target = repository.create({ name: 'ローソン' })
    const source = repository.create({ name: 'ローソン 東京日本橋店' })
    const accountId = insertAccount(db, 'expense', '食費')
    const entryId = insertJournalEntry(db)
    insertJournalLine(db, entryId, accountId, source.id)
    repository.addPattern(source.id, 'LAWSON NIHONBASHI')

    repository.merge(target.id, [source.id])

    const [result] = db.exec('SELECT * FROM counterparty_merge_log')
    const columns = result.columns
    const values = result.values[0]
    const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
    expect(get<number>('target_counterparty_id')).toBe(target.id)
    expect(get<string>('target_counterparty_name')).toBe('ローソン')
    expect(get<number>('source_counterparty_id')).toBe(source.id)
    expect(get<string>('source_counterparty_name')).toBe('ローソン 東京日本橋店')
    expect(get<number>('line_count')).toBe(1)
    expect(get<number>('pattern_count')).toBe(1)
  })

  it('複数の統合元を指定した場合、統合元ごとに1行ずつログを記録する', () => {
    const target = repository.create({ name: 'ローソン' })
    const sourceA = repository.create({ name: 'ローソン 東京日本橋店' })
    const sourceB = repository.create({ name: 'ローソン 大阪梅田店' })

    repository.merge(target.id, [sourceA.id, sourceB.id])

    const [result] = db.exec('SELECT source_counterparty_id FROM counterparty_merge_log ORDER BY id')
    expect(result.values.map((v) => v[0])).toEqual([sourceA.id, sourceB.id])
  })

  it('複数の統合元のうち途中で失敗した場合、それまでの付け替え・ログをロールバックする', () => {
    const target = repository.create({ name: 'ローソン' })
    const sourceA = repository.create({ name: 'ローソン 東京日本橋店' })
    const accountId = insertAccount(db, 'expense', '食費')
    const entryId = insertJournalEntry(db)
    const lineId = insertJournalLine(db, entryId, accountId, sourceA.id)
    const nonExistentSourceId = 9999

    expect(() => repository.merge(target.id, [sourceA.id, nonExistentSourceId])).toThrow()

    expect(queryCounterpartyIdOfLine(db, lineId)).toBe(sourceA.id)
    const [logResult] = db.exec('SELECT COUNT(*) FROM counterparty_merge_log')
    expect(logResult.values[0][0]).toBe(0)
  })

  it('統合後、統合元は仕訳・パターンともに0件になり物理削除できる', () => {
    const target = repository.create({ name: 'ローソン' })
    const source = repository.create({ name: 'ローソン 東京日本橋店' })
    const accountId = insertAccount(db, 'expense', '食費')
    const entryId = insertJournalEntry(db)
    insertJournalLine(db, entryId, accountId, source.id)

    repository.merge(target.id, [source.id])

    expect(() => repository.delete(source.id)).not.toThrow()
    expect(repository.findById(source.id)).toBeNull()
  })
})

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertAccount(database: Database, category: string, name: string): number {
  database.run(`INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, ?)`, [
    category,
    name,
    category === 'asset' || category === 'liability' ? 1 : null,
  ])
  return lastInsertRowId(database)
}

function insertJournalEntry(database: Database): number {
  database.run(`INSERT INTO household_members (name) VALUES ('自分')`)
  const memberId = lastInsertRowId(database)
  database.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`, [
    memberId,
  ])
  return lastInsertRowId(database)
}

function insertJournalLine(
  database: Database,
  journalEntryId: number,
  accountId: number,
  counterpartyId: number,
): number {
  database.run(
    `INSERT INTO journal_lines (journal_entry_id, account_id, counterparty_id, side, amount)
     VALUES (?, ?, ?, 'debit', 4000)`,
    [journalEntryId, accountId, counterpartyId],
  )
  return lastInsertRowId(database)
}

function queryCounterpartyIdOfLine(database: Database, lineId: number): number | null {
  const [result] = database.exec('SELECT counterparty_id FROM journal_lines WHERE id = ?', [
    lineId,
  ])
  if (!result) return null
  return result.values[0][0] as number | null
}
