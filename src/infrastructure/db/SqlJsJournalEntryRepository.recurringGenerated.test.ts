/**
 * SqlJsJournalEntryRepository.create()のgenerated_from_rule_id連携に関する統合テスト。
 * 定期取引(docs/domain/recurring-transactions.md 1.5節)から生成された仕訳は、生成元の
 * recurring_transaction_rule_idを参照のみの目的で記録する。計画Issue #121着手前の調査時点では
 * CreateJournalEntryInput/JournalEntryにこのフィールドが存在せず、生成しても永続化されない
 * 状態だったため、その回帰を検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'

let db: Database
let repository: SqlJsJournalEntryRepository
let bankAccountId: number
let rentExpenseAccountId: number
let memberId: number
let ruleId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id

  bankAccountId = accounts.create({
    category: 'liability',
    name: '未払金',
    isReconcilable: false,
  }).id
  rentExpenseAccountId = accounts.create({
    category: 'expense',
    name: '家賃',
    isReconcilable: null,
  }).id

  ruleId = new SqlJsRecurringTransactionRuleRepository(db).create({
    name: '家賃',
    debitAccountId: rentExpenseAccountId,
    creditAccountId: bankAccountId,
    amount: 80000,
    frequency: 'monthly',
    dayOfMonth: 1,
  }).id
})

describe('generatedFromRuleIdを渡した場合', () => {
  it('journal_entries.generated_from_rule_idに記録され、findByIdで読み出せる', () => {
    const entry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-09-01',
      sourceType: 'recurring_generated',
      generatedFromRuleId: ruleId,
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })

    expect(entry.generatedFromRuleId).toBe(ruleId)
    expect(repository.findById(entry.id)!.generatedFromRuleId).toBe(ruleId)
  })
})

describe('generatedFromRuleIdを渡さない場合', () => {
  it('journal_entries.generated_from_rule_idはnullのまま(通常のマニュアル起票と同じ挙動)', () => {
    const entry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-09-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })

    expect(entry.generatedFromRuleId).toBeNull()
  })
})
