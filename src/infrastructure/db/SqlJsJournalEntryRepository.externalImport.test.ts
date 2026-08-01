/**
 * SqlJsJournalEntryRepository.create()のexternalTransactionRef連携に関する統合テスト。
 * 外部明細取込のレビュー確定(docs/domain/statement-import.md 1.5 手順7)では、journal_entries/
 * journal_linesとexternal_transaction_refs(docs/domain/reconciliation.md 2章)を同一DBトランザクション
 * で書き込む必要がある。externalTransactionRefを渡した場合に両方が書き込まれること、
 * external_transaction_refs側の書き込みがUNIQUE(account_id, external_id)制約違反で失敗した場合に
 * journal_entries/journal_linesも含めてロールバックされ、孤立したjournal_entryが残らないことを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'

let db: Database
let repository: SqlJsJournalEntryRepository
let bankAccountId: number
let foodExpenseAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)

  bankAccountId = accounts.create({
    category: 'asset',
    name: '普通預金',
    isReconcilable: true,
  }).id
  foodExpenseAccountId = accounts.create({
    category: 'expense',
    name: '食費',
    isReconcilable: null,
  }).id
})

function countRows(table: string): number {
  const [result] = db.exec(`SELECT COUNT(*) AS count FROM ${table}`)
  return result!.values[0][0] as number
}

describe('externalTransactionRefを渡した場合', () => {
  it('journal_entries/journal_linesとexternal_transaction_refsを同一トランザクションで書き込む', () => {
    const entry = repository.create({
      entryDate: '2026-08-01',
      memo: 'セブンイレブン 日本橋店',
      sourceType: 'external_import',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 150 },
        { accountId: bankAccountId, side: 'credit', amount: 150 },
      ],
      externalTransactionRef: {
        accountId: bankAccountId,
        externalId: 'HASH-001',
        entryDate: '2026-08-01',
        description: 'セブンイレブン 日本橋店',
        amount: -150,
        externalBalanceAfter: 9850,
        isSettled: null,
      },
    })

    const [result] = db.exec(
      'SELECT account_id, journal_entry_id, external_id, amount FROM external_transaction_refs WHERE journal_entry_id = ?',
      [entry.id],
    )

    expect(result).toBeDefined()
    expect(result!.values[0]).toEqual([bankAccountId, entry.id, 'HASH-001', -150])
  })

  it('external_transaction_refsのUNIQUE制約違反時はjournal_entries/journal_linesも含めてロールバックする', () => {
    repository.create({
      entryDate: '2026-08-01',
      memo: '1件目',
      sourceType: 'external_import',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 100 },
        { accountId: bankAccountId, side: 'credit', amount: 100 },
      ],
      externalTransactionRef: {
        accountId: bankAccountId,
        externalId: 'HASH-DUP',
        entryDate: '2026-08-01',
        description: '1件目',
        amount: -100,
      },
    })

    const journalEntryCountBefore = countRows('journal_entries')
    const journalLineCountBefore = countRows('journal_lines')

    expect(() =>
      repository.create({
        entryDate: '2026-08-01',
        memo: '2件目(重複external_id)',
        sourceType: 'external_import',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 200 },
          { accountId: bankAccountId, side: 'credit', amount: 200 },
        ],
        externalTransactionRef: {
          accountId: bankAccountId,
          externalId: 'HASH-DUP',
          entryDate: '2026-08-01',
          description: '2件目',
          amount: -200,
        },
      }),
    ).toThrow()

    expect(countRows('journal_entries')).toBe(journalEntryCountBefore)
    expect(countRows('journal_lines')).toBe(journalLineCountBefore)
    expect(countRows('external_transaction_refs')).toBe(1)
  })
})

describe('externalTransactionRefを渡さない場合', () => {
  it('external_transaction_refsには何も書き込まれない(通常のマニュアル起票と同じ挙動)', () => {
    const accounts = new SqlJsAccountRepository(db)
    const cashAccountId = accounts.create({
      category: 'asset',
      name: '現金',
      isReconcilable: false,
    }).id

    repository.create({
      entryDate: '2026-08-01',
      memo: '手入力',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 100 },
        { accountId: cashAccountId, side: 'credit', amount: 100 },
      ],
    })

    expect(countRows('external_transaction_refs')).toBe(0)
  })
})
