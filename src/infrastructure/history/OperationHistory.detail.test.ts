/**
 * OperationHistoryの「操作の詳細」(計画Issue #295)の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、仕訳・仕訳明細への書き込みから、
 * 履歴の一覧に出す「どの仕訳をどう変えたか」(作成・編集・削除、前後の値、科目名)が作られることを検証する。
 * 検証する範囲: 作成・編集・削除それぞれの内容、科目が統合で消えたあとも履歴の科目名が残ること、
 * 大量の操作の要約(件数・先頭の数件・使った科目の件数)、仕訳以外の操作には詳細が付かないこと、
 * 取込のような操作グループに添えるメタ情報、取消の動作が変わらないこと。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { createOperationHistory, type OperationHistory } from './OperationHistory'
import { DETAIL_ENTRY_LIMIT } from './operationDetail'

let db: Database
let history: OperationHistory
let accounts: SqlJsAccountRepository
let journal: SqlJsJournalEntryRepository
let memberId: number
let cashId: number
let foodId: number
let fuelId: number

function scalar(sql: string): number {
  return db.exec(sql)[0].values[0][0] as number
}

function createEntry(input: { amount: number; memo?: string; date?: string; accountId?: number }) {
  return journal.create({
    householdMemberId: memberId,
    entryDate: input.date ?? '2026-11-01',
    memo: input.memo ?? null,
    lines: [
      { householdMemberId: memberId, accountId: input.accountId ?? foodId, side: 'debit', amount: input.amount },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: input.amount },
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
  fuelId = accounts.create({ category: 'expense', name: '車両費', isReconcilable: null }).id
  history = createOperationHistory(db, { limit: 50 })
})

describe('仕訳の作成', () => {
  it('作成した仕訳の日付・摘要・借方貸方の科目名と金額が、作成の詳細として残る', () => {
    history.record('journalEntry.create', () => createEntry({ amount: 5400, memo: 'ガソリン', date: '2026-11-25', accountId: fuelId }))

    const detail = history.list()[0].detail
    expect(detail?.entryTotal).toBe(1)
    expect(detail?.entries).toHaveLength(1)
    expect(detail?.entries[0]).toMatchObject({
      kind: 'created',
      before: null,
      after: {
        date: '2026-11-25',
        memo: 'ガソリン',
        lines: [
          { side: 'debit', accountName: '車両費', amount: 5400 },
          { side: 'credit', accountName: '現金', amount: 5400 },
        ],
      },
    })
  })
})

describe('仕訳の編集', () => {
  it('摘要と金額を変えると、編集前と編集後の両方の内容が残る', () => {
    const entry = history.record('journalEntry.create', () => createEntry({ amount: 980, memo: 'ランチ' }))
    history.record('journalEntry.update', () =>
      journal.update(entry.id, {
        entryDate: '2026-11-01',
        memo: '日替わりランチ',
        lines: entry.lines.map((line) => ({
          id: line.id,
          householdMemberId: line.householdMemberId,
          accountId: line.accountId,
          side: line.side,
          amount: 1180,
        })),
      }),
    )

    const operation = history.list()[0]
    expect(operation.label).toBe('journalEntry.update')
    expect(operation.detail?.entries[0]).toMatchObject({
      kind: 'updated',
      before: { memo: 'ランチ', lines: [{ amount: 980 }, { amount: 980 }] },
      after: { memo: '日替わりランチ', lines: [{ amount: 1180 }, { amount: 1180 }] },
    })
  })

  it('借方の科目を付け替えると、編集前後の科目名が残る', () => {
    const entry = history.record('journalEntry.create', () => createEntry({ amount: 1000 }))
    history.record('journalEntry.update', () =>
      journal.update(entry.id, {
        entryDate: '2026-11-01',
        lines: entry.lines.map((line) => ({
          id: line.id,
          householdMemberId: line.householdMemberId,
          accountId: line.side === 'debit' ? fuelId : line.accountId,
          side: line.side,
          amount: line.amount,
        })),
      }),
    )

    const change = history.list()[0].detail?.entries[0]
    expect(change?.before?.lines[0]).toMatchObject({ side: 'debit', accountName: '食費' })
    expect(change?.after?.lines[0]).toMatchObject({ side: 'debit', accountName: '車両費' })
  })

  it('内容が変わっていない編集(更新日時だけの変化)は、仕訳の変更として数えない', () => {
    const entry = history.record('journalEntry.create', () => createEntry({ amount: 1000, memo: 'そのまま' }))
    history.record('journalEntry.update', () =>
      journal.update(entry.id, {
        entryDate: '2026-11-01',
        memo: 'そのまま',
        lines: entry.lines.map((line) => ({
          id: line.id,
          householdMemberId: line.householdMemberId,
          accountId: line.accountId,
          side: line.side,
          amount: line.amount,
        })),
      }),
    )

    expect(history.list()[0].detail).toBeUndefined()
  })
})

describe('仕訳の削除', () => {
  it('削除した仕訳の内容(日付・摘要・科目名・金額)が、削除の詳細として残る', () => {
    const entry = history.record('journalEntry.create', () => createEntry({ amount: 3200, memo: 'スーパー', date: '2026-11-20' }))
    history.record('journalEntry.delete', () => journal.delete(entry.id))

    expect(history.list()[0].detail?.entries[0]).toMatchObject({
      kind: 'deleted',
      after: null,
      before: {
        date: '2026-11-20',
        memo: 'スーパー',
        lines: [
          { side: 'debit', accountName: '食費', amount: 3200 },
          { side: 'credit', accountName: '現金', amount: 3200 },
        ],
      },
    })
  })
})

describe('科目名の保持', () => {
  it('科目を統合して元の科目が消えたあとも、統合前の仕訳の科目名が履歴に残る', () => {
    const entry = history.record('journalEntry.create', () => createEntry({ amount: 1000, accountId: fuelId }))
    history.record('account.merge', () => accounts.merge(foodId, [fuelId]))

    const change = history.list()[0].detail?.entries.find((e) => e.entryId === entry.id)
    expect(change?.kind).toBe('updated')
    expect(change?.before?.lines[0].accountName).toBe('車両費')
    expect(change?.after?.lines[0].accountName).toBe('食費')
  })
})

describe('大量の操作の要約', () => {
  it('件数は全件分を持ち、詳細に載せる仕訳は先頭の数件だけで、使った科目は全件から件数を数える', () => {
    history.beginGroup('statementImport.confirm')
    const total = DETAIL_ENTRY_LIMIT + 3
    for (let i = 0; i < total; i++) {
      history.record('journalEntry.create', () =>
        createEntry({ amount: 100 + i, accountId: i < 6 ? foodId : fuelId, date: `2026-11-${String(i + 1).padStart(2, '0')}` }),
      )
    }
    history.endGroup()

    const operation = history.list()[0]
    expect(history.list()).toHaveLength(1)
    expect(operation.detail?.entryTotal).toBe(total)
    expect(operation.detail?.entries).toHaveLength(DETAIL_ENTRY_LIMIT)
    expect(operation.detail?.entries[0].after?.date).toBe('2026-11-01')
    expect(operation.detail?.accountUsage).toEqual([
      { name: '現金', count: total },
      { name: '食費', count: 6 },
      { name: '車両費', count: total - 6 },
    ].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)))
  })

  it('作成・編集・削除それぞれの仕訳の件数を、全件分持つ', () => {
    const kept = createEntry({ amount: 100 })
    const doomed = createEntry({ amount: 200 })
    history.beginGroup('expenseSplit.submit')
    createEntry({ amount: 300 })
    journal.delete(doomed.id)
    journal.update(kept.id, {
      entryDate: '2026-11-02',
      lines: kept.lines.map((line) => ({
        id: line.id,
        householdMemberId: line.householdMemberId,
        accountId: line.accountId,
        side: line.side,
        amount: line.amount,
      })),
    })
    history.endGroup()

    expect(history.list()[0].detail?.kinds).toEqual({ created: 1, updated: 1, deleted: 1 })
  })

  it('変更した仕訳すべての日付の範囲(最も古い日付と新しい日付)を持つ', () => {
    history.beginGroup('statementImport.confirm')
    for (const date of ['2026-11-12', '2026-11-03', '2026-11-25', '2026-11-09']) createEntry({ amount: 100, date })
    history.endGroup()

    expect(history.list()[0].detail?.dateRange).toEqual({ from: '2026-11-03', to: '2026-11-25' })
  })

  it('同じ操作の中で作ってから消した仕訳は、詳細に出さない', () => {
    history.beginGroup('expenseSplit.submit')
    const entry = createEntry({ amount: 500 })
    journal.delete(entry.id)
    history.endGroup()

    expect(history.list()).toHaveLength(1)
    expect(history.list()[0].detail).toBeUndefined()
  })
})

describe('仕訳以外の操作', () => {
  it('科目の作成のような、仕訳に触れない操作には詳細が付かない', () => {
    history.record('account.create', () => accounts.create({ category: 'expense', name: '雑費', isReconcilable: null }))

    expect(history.list()[0].detail).toBeUndefined()
  })
})

describe('操作グループのメタ情報', () => {
  it('endGroupに渡したメタ情報が、その操作に付いて一覧から読める', () => {
    history.beginGroup('statementImport.confirm')
    createEntry({ amount: 480 })
    history.endGroup({
      kind: 'statementImport',
      institution: '楽天カード',
      targetAccountName: '楽天カード(未払金)',
      files: [{ name: 'rakuten_202511.csv', count: 1 }],
    })

    expect(history.list()[0].meta).toEqual({
      kind: 'statementImport',
      institution: '楽天カード',
      targetAccountName: '楽天カード(未払金)',
      files: [{ name: 'rakuten_202511.csv', count: 1 }],
    })
  })

  it('メタ情報を渡さなければ、操作にメタ情報は付かない', () => {
    history.beginGroup('expenseSplit.submit')
    createEntry({ amount: 480 })
    history.endGroup()

    expect(history.list()[0].meta).toBeUndefined()
  })
})

describe('取消', () => {
  it('詳細を記録するようになっても、取消で仕訳が元どおりに戻る', () => {
    const entry = history.record('journalEntry.create', () => createEntry({ amount: 1000, memo: '消す' }))
    history.record('journalEntry.delete', () => journal.delete(entry.id))
    const deleteId = history.list()[0].id

    history.undoTo(deleteId)

    expect(journal.findById(entry.id)?.memo).toBe('消す')
  })
})
