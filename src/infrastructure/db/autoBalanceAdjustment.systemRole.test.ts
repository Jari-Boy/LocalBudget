/**
 * 自動調整仕訳の相手科目を役割(system_role = balance_adjustment)で引くことの統合テスト(計画Issue #223)。
 * 費用のシステム管理科目が「残高調整」以外(雑損失)にもあっても、また「残高調整」が改名されても、
 * 調整仕訳は常に残高調整の科目に入ることを検証する。外部依存: sql.js のみ。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedInitialBalanceAccount } from './seedInitialBalanceAccount'
import { seedSettlementAdjustmentAccounts } from './seedSettlementAdjustmentAccounts'
import { SqlJsAccountBalanceRecordRepository } from './SqlJsAccountBalanceRecordRepository'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'

let db: Database
let accounts: SqlJsAccountRepository
let journal: SqlJsJournalEntryRepository
let records: SqlJsAccountBalanceRecordRepository
let cashId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accounts = new SqlJsAccountRepository(db)
  journal = new SqlJsJournalEntryRepository(db)
  records = new SqlJsAccountBalanceRecordRepository(db)
  new SqlJsHouseholdMemberRepository(db).create({ name: '自分' })
  seedInitialBalanceAccount(db)
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
})

/** 現金に10000円の基準点を置いたあと、帳簿と食い違う基準点を置いて、残高調整の仕訳を発生させる */
function createAdjustmentEntry() {
  records.create({ accountId: cashId, recordDate: '2026-01-31', balance: 10000 })
  records.create({ accountId: cashId, recordDate: '2026-02-28', balance: 7000 })
  return journal
    .findAll()
    .find((e) => e.sourceType === 'auto_balance_adjustment' && e.entryDate === '2026-02-28')!
}

function counterAccountName(entry: ReturnType<typeof createAdjustmentEntry>): string {
  const counter = entry.lines.find((l) => l.accountId !== cashId)!
  return accounts.findById(counter.accountId)!.name
}

describe('自動調整仕訳の相手科目は役割で決まる', () => {
  it('雑損失(費用のシステム管理科目)が先に作られていても、調整仕訳は残高調整に入る', () => {
    seedSettlementAdjustmentAccounts(db)
    seedBalanceAdjustmentAccount(db)

    expect(counterAccountName(createAdjustmentEntry())).toBe('残高調整')
  })

  it('残高調整を改名しても、調整仕訳はその科目に入る', () => {
    seedBalanceAdjustmentAccount(db)
    const adjustment = accounts.findAll().find((a) => a.systemRole === 'balance_adjustment')!
    accounts.update(adjustment.id, { name: '帳簿の調整' })
    seedSettlementAdjustmentAccounts(db)

    expect(counterAccountName(createAdjustmentEntry())).toBe('帳簿の調整')
  })
})
