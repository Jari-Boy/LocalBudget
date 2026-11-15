/**
 * OperationHistory(操作履歴・ロールバック、計画Issue #202)の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、Repositoryの書き込みを一時テーブル(TEMP)の
 * トリガーが自動で記録し、「選んだ操作とそれ以降」を新しい順に逆順で戻せることを検証する。
 * 検証する範囲: 仕訳の作成・編集・削除と波及削除(関連仕訳グループ)の復元、バッチ(グループ)を履歴上1件と
 * して扱うこと、科目統合のような広範囲の書き換えの取消、上限を超えた古い履歴の破棄、
 * バックアップ(db.export)に履歴が含まれないこと、取消の途中で失敗したときに全体がROLLBACKされること。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../db/SqlJsCounterpartyRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { SqlJsJournalEntryLinkGroupRepository } from '../db/SqlJsJournalEntryLinkGroupRepository'
import { createOperationHistory, OperationNotFoundError, type OperationHistory } from './OperationHistory'

let db: Database
let history: OperationHistory
let accounts: SqlJsAccountRepository
let journal: SqlJsJournalEntryRepository
let memberId: number
let cashId: number
let foodId: number
let miscId: number

function scalar(sql: string): number {
  return db.exec(sql)[0].values[0][0] as number
}

function createEntry(amount: number, accountId = foodId) {
  return journal.create({
    householdMemberId: memberId,
    entryDate: '2026-11-01',
    lines: [
      { householdMemberId: memberId, accountId, side: 'debit', amount },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount },
    ],
  })
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
  memberId = scalar('SELECT last_insert_rowid()')
  accounts = new SqlJsAccountRepository(db)
  journal = new SqlJsJournalEntryRepository(db)
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  miscId = accounts.create({ category: 'expense', name: '雑費', isReconcilable: null }).id
  history = createOperationHistory(db, { limit: 50 })
})

describe('記録', () => {
  it('書き込みを伴う呼び出しだけが1件の操作として履歴に残り、読み取りだけの呼び出しは残らない', () => {
    history.record('journalEntry.create', () => createEntry(1000))
    history.record('journalEntry.findAll', () => journal.findAll())

    const list = history.list()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('journalEntry.create')
  })

  it('一覧は新しい順で、変更した表ごとの件数(追加・変更・削除)を持つ', () => {
    const entry = history.record('journalEntry.create', () => createEntry(1000))
    history.record('journalEntry.delete', () => journal.delete(entry.id))

    const [newest, oldest] = history.list()
    expect(newest.label).toBe('journalEntry.delete')
    expect(newest.changes).toEqual(
      expect.arrayContaining([
        { table: 'journal_entries', inserted: 0, updated: 0, deleted: 1 },
        { table: 'journal_lines', inserted: 0, updated: 0, deleted: 2 },
      ]),
    )
    expect(oldest.changes).toEqual(
      expect.arrayContaining([
        { table: 'journal_entries', inserted: 1, updated: 0, deleted: 0 },
        { table: 'journal_lines', inserted: 2, updated: 0, deleted: 0 },
      ]),
    )
  })

  it('呼び出しが失敗してROLLBACKされた書き込みは履歴に残さない', () => {
    expect(() =>
      history.record('journalEntry.create', () =>
        journal.create({
          householdMemberId: memberId,
          entryDate: '2026-11-01',
          lines: [
            { householdMemberId: memberId, accountId: foodId, side: 'debit', amount: 1000 },
            { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 900 },
          ],
        }),
      ),
    ).toThrow()

    expect(history.list()).toHaveLength(0)
  })

  it('グループ内の複数の呼び出しは履歴上1件にまとまる', () => {
    history.beginGroup('statementImport.confirm')
    for (let i = 0; i < 5; i++) createEntry(100 + i)
    history.endGroup()

    const list = history.list()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('statementImport.confirm')
    expect(list[0].changes).toContainEqual({ table: 'journal_entries', inserted: 5, updated: 0, deleted: 0 })
  })

  it('何も書き込まなかったグループは履歴に残さない', () => {
    history.beginGroup('statementImport.confirm')
    history.endGroup()

    expect(history.list()).toHaveLength(0)
  })

  it('上限を超えると古い操作から破棄する', () => {
    const small = createOperationHistory(db, { limit: 3 })
    for (let i = 0; i < 5; i++) small.record('journalEntry.create', () => createEntry(100 + i))

    expect(small.list()).toHaveLength(3)
    expect(scalar('SELECT COUNT(*) FROM journal_entries')).toBe(5)
  })
})

describe('バックアップに含まれない', () => {
  it('db.exportしたデータには履歴の表もトリガーも入らない', async () => {
    history.record('journalEntry.create', () => createEntry(1000))

    const exported = db.export()
    const restored = new (db.constructor as new (data: Uint8Array) => Database)(exported)
    const names = restored
      .exec(`SELECT name FROM sqlite_master WHERE name LIKE '%undo%'`)
    expect(names).toHaveLength(0)
  })
})

describe('取消', () => {
  it('仕訳の作成を取り消すと仕訳が消える', () => {
    const entry = history.record('journalEntry.create', () => createEntry(1000))

    history.undoTo(history.list()[0].id)

    expect(journal.findById(entry.id)).toBeNull()
    expect(history.list()).toHaveLength(0)
  })

  it('仕訳の編集を取り消すと元の金額に戻る', () => {
    const entry = history.record('journalEntry.create', () => createEntry(1000))
    history.record('journalEntry.update', () =>
      journal.update(entry.id, {
        householdMemberId: memberId,
        entryDate: '2026-11-02',
        memo: '変更後',
        lines: [
          { householdMemberId: memberId, accountId: foodId, side: 'debit', amount: 2500 },
          { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 2500 },
        ],
      }),
    )

    history.undoTo(history.list()[0].id)

    const restored = journal.findById(entry.id)
    expect(restored?.entryDate).toBe('2026-11-01')
    expect(restored?.memo ?? null).toBeNull()
    expect(restored?.lines.map((l) => l.amount)).toEqual([1000, 1000])
  })

  it('仕訳の削除を取り消すと、明細と関連仕訳グループへの所属も元に戻る', () => {
    const a = createEntry(1000)
    const b = createEntry(2000)
    const links = new SqlJsJournalEntryLinkGroupRepository(db)
    links.createGroup([a.id, b.id])
    const memberships = scalar('SELECT COUNT(*) FROM journal_entry_link_group_memberships')

    history.record('journalEntry.delete', () => journal.delete(a.id))
    expect(scalar('SELECT COUNT(*) FROM journal_entry_link_group_memberships')).toBe(memberships - 1)

    history.undoTo(history.list()[0].id)

    expect(journal.findById(a.id)?.lines).toHaveLength(2)
    expect(scalar('SELECT COUNT(*) FROM journal_entry_link_group_memberships')).toBe(memberships)
  })

  it('選んだ操作とそれ以降だけを戻し、それより前の操作は残す', () => {
    const first = history.record('journalEntry.create', () => createEntry(100))
    const second = history.record('journalEntry.create', () => createEntry(200))
    const third = history.record('journalEntry.create', () => createEntry(300))
    const ops = history.list() // 新しい順: third, second, first

    const undone = history.undoTo(ops[1].id)

    expect(undone).toBe(2)
    expect(journal.findById(first.id)).not.toBeNull()
    expect(journal.findById(second.id)).toBeNull()
    expect(journal.findById(third.id)).toBeNull()
    expect(history.list()).toHaveLength(1)
  })

  it('グループ(バッチ)は1回の取消で全体が戻る', () => {
    history.beginGroup('statementImport.confirm')
    for (let i = 0; i < 30; i++) createEntry(100 + i)
    history.endGroup()

    history.undoTo(history.list()[0].id)

    expect(scalar('SELECT COUNT(*) FROM journal_entries')).toBe(0)
  })

  it('科目統合(多数の仕訳の付け替え)も、付け替えた仕訳と統合の記録ごと戻せる', () => {
    const entries = [createEntry(100, miscId), createEntry(200, miscId), createEntry(300, miscId)]
    history.record('account.merge', () => accounts.merge(foodId, [miscId]))
    expect(journal.findById(entries[0].id)?.lines.some((l) => l.accountId === foodId)).toBe(true)

    history.undoTo(history.list()[0].id)

    for (const entry of entries) {
      const lines = journal.findById(entry.id)?.lines ?? []
      expect(lines.some((l) => l.accountId === miscId)).toBe(true)
    }
    expect(scalar('SELECT COUNT(*) FROM account_merge_log')).toBe(0)
  })

  it('マスタの作成を取り消すと削除される', () => {
    const counterparties = new SqlJsCounterpartyRepository(db)
    const created = history.record('counterparty.create', () => counterparties.create({ name: 'カフェB' }))

    history.undoTo(history.list()[0].id)

    expect(counterparties.findById(created.id)).toBeNull()
  })

  it('取消そのものは履歴に残らず、取消後の新しい操作は通常どおり記録される', () => {
    history.record('journalEntry.create', () => createEntry(100))
    history.undoTo(history.list()[0].id)
    history.record('journalEntry.create', () => createEntry(200))

    expect(history.list()).toHaveLength(1)
  })

  it('存在しない(破棄済みの)操作を指定するとOperationNotFoundErrorを投げ、何も戻さない', () => {
    const entry = history.record('journalEntry.create', () => createEntry(100))

    expect(() => history.undoTo(9999)).toThrow(OperationNotFoundError)
    expect(journal.findById(entry.id)).not.toBeNull()
  })

  it('取消の途中で失敗したら全体をROLLBACKし、何も戻さず履歴も保つ', () => {
    const entry = history.record('journalEntry.create', () => createEntry(100))
    history.record('journalEntry.create', () => createEntry(200))
    // 取消の途中で必ず失敗するよう、最古の操作の逆操作を存在しない表への書き込みに差し替える
    const ops = history.list()
    db.run(
      `UPDATE __undo_log SET undo_sql = 'INSERT INTO no_such_table VALUES (1)' WHERE seq = (SELECT MIN(seq) FROM __undo_log)`,
    )

    expect(() => history.undoTo(ops[1].id)).toThrow()

    expect(journal.findById(entry.id)).not.toBeNull()
    expect(scalar('SELECT COUNT(*) FROM journal_entries')).toBe(2)
    expect(history.list()).toHaveLength(2)
  })
})

describe('取消の影響範囲(プレビュー)', () => {
  it('選んだ操作以降を新しい順に返し、より前の操作の件数も返す', () => {
    history.record('journalEntry.create', () => createEntry(100))
    history.record('journalEntry.create', () => createEntry(200))
    history.record('journalEntry.create', () => createEntry(300))
    const ops = history.list()

    const preview = history.previewUndoTo(ops[1].id)

    expect(preview.operations.map((o) => o.id)).toEqual([ops[0].id, ops[1].id])
    expect(preview.keptCount).toBe(1)
  })

  it('存在しない操作を指定するとOperationNotFoundErrorを投げる', () => {
    expect(() => history.previewUndoTo(1)).toThrow(OperationNotFoundError)
  })
})
