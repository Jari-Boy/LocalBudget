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
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedInitialBalanceAccount } from './seedInitialBalanceAccount'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'

let db: Database
let repository: SqlJsJournalEntryRepository
let bankAccountId: number
let foodExpenseAccountId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  // 取引後残高付きの取込は基準点になり、自動調整仕訳の相手科目(初期残高・残高調整)が必要になる(計画Issue #205)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id

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
      householdMemberId: memberId,
      entryDate: '2026-08-01',
      memo: 'セブンイレブン 日本橋店',
      sourceType: 'external_import',
      lines: [
        { householdMemberId: memberId, accountId: foodExpenseAccountId, side: 'debit', amount: 150 },
        { householdMemberId: memberId, accountId: bankAccountId, side: 'credit', amount: 150 },
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
      householdMemberId: memberId,
      entryDate: '2026-08-01',
      memo: '1件目',
      sourceType: 'external_import',
      lines: [
        { householdMemberId: memberId, accountId: foodExpenseAccountId, side: 'debit', amount: 100 },
        { householdMemberId: memberId, accountId: bankAccountId, side: 'credit', amount: 100 },
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
        householdMemberId: memberId,
        entryDate: '2026-08-01',
        memo: '2件目(重複external_id)',
        sourceType: 'external_import',
        lines: [
          { householdMemberId: memberId, accountId: foodExpenseAccountId, side: 'debit', amount: 200 },
          { householdMemberId: memberId, accountId: bankAccountId, side: 'credit', amount: 200 },
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

describe('取込の記録の金融機関名(計画Issue #289)', () => {
  function createImported(externalId: string, financialInstitutionName?: string | null) {
    return repository.create({
      householdMemberId: memberId,
      entryDate: '2026-08-01',
      memo: externalId,
      sourceType: 'external_import',
      lines: [
        { householdMemberId: memberId, accountId: foodExpenseAccountId, side: 'debit', amount: 150 },
        { householdMemberId: memberId, accountId: bankAccountId, side: 'credit', amount: 150 },
      ],
      externalTransactionRef: {
        accountId: bankAccountId,
        externalId,
        entryDate: '2026-08-01',
        description: externalId,
        amount: -150,
        ...(financialInstitutionName === undefined ? {} : { financialInstitutionName }),
      },
    })
  }

  it('取込時に渡した金融機関名が、仕訳の読み出し(findById・findAll)で financialInstitutionName として返る', () => {
    const entry = createImported('HASH-BANK', '三井住友銀行')

    expect(repository.findById(entry.id)!.financialInstitutionName).toBe('三井住友銀行')
    expect(repository.findAll().find((e) => e.id === entry.id)!.financialInstitutionName).toBe('三井住友銀行')
  })

  it('金融機関名を渡さない取込の仕訳は、financialInstitutionName が null になる', () => {
    const entry = createImported('HASH-NONE')

    expect(repository.findById(entry.id)!.financialInstitutionName).toBeNull()
  })

  it('取込でない仕訳(手入力)は、financialInstitutionName が null になる', () => {
    const entry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-08-01',
      lines: [
        { householdMemberId: memberId, accountId: foodExpenseAccountId, side: 'debit', amount: 100 },
        { householdMemberId: memberId, accountId: bankAccountId, side: 'credit', amount: 100 },
      ],
    })

    expect(repository.findById(entry.id)!.financialInstitutionName).toBeNull()
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
      householdMemberId: memberId,
      entryDate: '2026-08-01',
      memo: '手入力',
      lines: [
        { householdMemberId: memberId, accountId: foodExpenseAccountId, side: 'debit', amount: 100 },
        { householdMemberId: memberId, accountId: cashAccountId, side: 'credit', amount: 100 },
      ],
    })

    expect(countRows('external_transaction_refs')).toBe(0)
  })
})
