/**
 * SqlJsJournalEntryDraftRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md 3章に定義された
 * 仕訳の下書き(journal_entry_drafts/journal_entry_draft_lines)の作成・参照・更新
 * (バランス検証・必須項目チェックなしでの入力途中状態の保存)・破棄、および確定操作
 * (JournalEntryRepository.create経由での通常のバランス検証・is_reconcilable記帳制限を
 * 受けたうえでの仕訳化、成功時の下書き削除・失敗時の下書き非削除)を検証する。
 * 起票者(household_member_id)は下書き段階では未入力状態を許容するためNULL可だが
 * (計画Issue #88、journal_entries.household_member_idと異なりバランス制約と同様に
 * 下書き段階では必須化の対象外、docs/domain/journal.md 3章)、確定時にはJournalEntryRepository
 * 側のNOT NULL制約により必須となることもあわせて検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsJournalEntryDraftRepository } from './SqlJsJournalEntryDraftRepository'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'

let db: Database
let repository: SqlJsJournalEntryDraftRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let foodExpenseAccountId: number
let cashAccountId: number
let householdMemberId: number

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
  householdMemberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
})

describe('create / findById', () => {
  it('全フィールドが未入力の下書きを作成する', () => {
    const created = repository.create({})

    expect(created.purpose).toBe('manual_entry')
    expect(created.entryDate).toBeNull()
    expect(created.memo).toBeNull()
    expect(created.currency).toBeNull()
    expect(created.householdMemberId).toBeNull()
    expect(created.lines).toHaveLength(0)
  })

  it('起票者(householdMemberId)を指定して下書きを作成できる', () => {
    const created = repository.create({ householdMemberId })

    expect(repository.findById(created.id)?.householdMemberId).toBe(householdMemberId)
  })

  it('一部だけ入力された明細(借方のみ入力済み)を持つ下書きを作成する', () => {
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

  it('全フィールドが未入力の明細を持つ下書きを作成する', () => {
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

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した全ての下書きを返す', () => {
    repository.create({ memo: '下書き1' })
    repository.create({ memo: '下書き2' })

    expect(repository.findAll()).toHaveLength(2)
  })
})

describe('update(バランス検証なしの全差し替え)', () => {
  it('バランス検証を一切行わずにフィールド・明細を全差し替えする', () => {
    const created = repository.create({
      memo: '当初の内容',
      lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
    })

    const updated = repository.update(created.id, {
      entryDate: '2026-07-21',
      memo: '更新後の内容',
      householdMemberId,
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 5000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    expect(updated.memo).toBe('更新後の内容')
    expect(updated.entryDate).toBe('2026-07-21')
    expect(updated.householdMemberId).toBe(householdMemberId)
    expect(updated.lines).toHaveLength(2)
  })
})

describe('delete', () => {
  it('下書きとその明細を破棄する', () => {
    const created = repository.create({
      lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })
})

describe('confirm', () => {
  it('完成した下書きをJournalEntryRepository経由で仕訳に変換し、成功時は下書きを削除する', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      memo: 'スーパーで食材購入',
      householdMemberId,
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    const confirmed = repository.confirm(created.id, journalEntryRepository)

    expect(confirmed.entryDate).toBe('2026-07-22')
    expect(confirmed.householdMemberId).toBe(householdMemberId)
    expect(confirmed.lines).toHaveLength(2)
    expect(journalEntryRepository.findById(confirmed.id)).not.toBeNull()
    expect(repository.findById(created.id)).toBeNull()
  })

  it('下書きの明細が貸借不一致の場合はUnbalancedJournalEntryErrorをスローし、下書きを残す', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      householdMemberId,
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

  it('起票者(householdMemberId)が未入力のまま確定しようとするとエラーになり、下書きを残す(計画Issue #88)', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    expect(() => repository.confirm(created.id, journalEntryRepository)).toThrow()

    expect(repository.findById(created.id)).not.toBeNull()
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })
})
