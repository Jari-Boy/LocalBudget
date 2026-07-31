/**
 * SqlJsJournalEntryDraftRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md 3章に定義された
 * 仕訳の下書き(journal_entry_drafts/journal_entry_draft_lines)の作成・参照・更新
 * (バランス検証・必須項目チェックなしでの入力途中状態の保存)・破棄、および確定操作
 * (JournalEntryRepository.create経由での通常のバランス検証・is_reconcilable記帳制限を
 * 受けたうえでの仕訳化、成功時の下書き削除・失敗時の下書き非削除)を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsJournalEntryDraftRepository } from './SqlJsJournalEntryDraftRepository'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'

let db: Database
let repository: SqlJsJournalEntryDraftRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let foodExpenseAccountId: number
let cashAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryDraftRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)

  foodExpenseAccountId = accounts.create({
    category: 'expense',
    name: '食費',
    isReconcilable: null,
  }).id
  cashAccountId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
})

describe('create / findById', () => {
  it('creates a draft with no fields filled in yet', () => {
    const created = repository.create({})

    expect(created.purpose).toBe('manual_entry')
    expect(created.entryDate).toBeNull()
    expect(created.memo).toBeNull()
    expect(created.currency).toBeNull()
    expect(created.lines).toHaveLength(0)
  })

  it('creates a draft with a partially filled-in line (only debit side entered)', () => {
    const created = repository.create({
      entryDate: '2026-07-20',
      lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 3000 }],
    })

    const found = repository.findById(created.id)
    expect(found?.entryDate).toBe('2026-07-20')
    expect(found?.lines).toHaveLength(1)
    expect(found?.lines[0]).toMatchObject({
      accountId: foodExpenseAccountId,
      side: 'debit',
      amount: 3000,
    })
  })

  it('creates a draft line with all fields left blank', () => {
    const created = repository.create({
      lines: [{}],
    })

    const found = repository.findById(created.id)
    expect(found?.lines[0]).toMatchObject({
      accountId: null,
      side: null,
      amount: null,
    })
  })

  it('returns null for an id that does not exist', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('returns every created draft', () => {
    repository.create({ memo: '下書き1' })
    repository.create({ memo: '下書き2' })

    expect(repository.findAll()).toHaveLength(2)
  })
})

describe('update(バランス検証なしの全差し替え)', () => {
  it('replaces the fields and lines without any balance validation', () => {
    const created = repository.create({
      memo: '当初の内容',
      lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
    })

    const updated = repository.update(created.id, {
      entryDate: '2026-07-21',
      memo: '更新後の内容',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 5000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    expect(updated.memo).toBe('更新後の内容')
    expect(updated.entryDate).toBe('2026-07-21')
    expect(updated.lines).toHaveLength(2)
  })
})

describe('delete', () => {
  it('discards a draft and its lines', () => {
    const created = repository.create({
      lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })
})

describe('confirm', () => {
  it('converts a complete draft into a journal entry via JournalEntryRepository and deletes the draft on success', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      memo: 'スーパーで食材購入',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    const confirmed = repository.confirm(created.id, journalEntryRepository)

    expect(confirmed.entryDate).toBe('2026-07-22')
    expect(confirmed.lines).toHaveLength(2)
    expect(journalEntryRepository.findById(confirmed.id)).not.toBeNull()
    expect(repository.findById(created.id)).toBeNull()
  })

  it('throws UnbalancedJournalEntryError and keeps the draft when the draft lines are unbalanced', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 2000 },
      ],
    })

    expect(() => repository.confirm(created.id, journalEntryRepository)).toThrow(
      UnbalancedJournalEntryError,
    )

    expect(repository.findById(created.id)).not.toBeNull()
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })
})
