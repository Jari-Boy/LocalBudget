/**
 * マスタの削除条件のDB制約の統合テスト(計画Issue #154)。
 * Issue #154の削除条件の表(科目・取引先・プロジェクト・世帯メンバー・定期仕訳ルール)のうち、
 * 仕訳以外の参照(定期仕訳ルール・精算バッチの相手・仕訳の起票者・科目の名義)でも、DBが
 * 物理削除を拒否することを実際に確かめる。docs/domain/counterparties.md・projects.mdの削除条件が
 * 仕訳だけを挙げていた記述の誤りを訂正する根拠(Issueの懸念点「コード読解のみ、未実行」の検証)。
 * 画面側はこの制約を事前に判定して理由を表示する(summarizeMasterUsage)ため、DBは最終防御線である。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'
import { SqlJsSettlementBatchRepository } from './SqlJsSettlementBatchRepository'

let db: Database
let accounts: SqlJsAccountRepository
let expenseId: number
let cashId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accounts = new SqlJsAccountRepository(db)
  expenseId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
})

/** 行(借方の費用・貸方の現金)や起票者に、削除を確かめたいマスタを設定したルールを作る(計画Issue #180) */
function createRule(
  options: { counterpartyId?: number; projectId?: number; lineHouseholdMemberId?: number; bookkeeperId?: number } = {},
) {
  return new SqlJsRecurringTransactionRuleRepository(db).create({
    name: '毎月の食費',
    bookkeeperHouseholdMemberId: options.bookkeeperId ?? null,
    lines: [
      {
        side: 'debit',
        accountId: expenseId,
        amount: 1000,
        counterpartyId: options.counterpartyId,
        projectId: options.projectId,
        householdMemberId: options.lineHouseholdMemberId,
      },
      { side: 'credit', accountId: cashId, amount: 1000 },
    ],
    frequency: 'monthly',
    dayOfMonth: 1,
  })
}

describe('マスタの削除条件のDB制約(仕訳以外の参照)', () => {
  it('定期仕訳ルールの起票者になっている世帯メンバーは、物理削除できない(計画Issue #180)', () => {
    const members = new SqlJsHouseholdMemberRepository(db)
    createRule({ bookkeeperId: memberId })

    expect(() => members.delete(memberId)).toThrow()
    expect(members.findById(memberId)).not.toBeNull()
  })

  it('定期仕訳ルールで使われている取引先は、物理削除できない', () => {
    const counterparties = new SqlJsCounterpartyRepository(db)
    const counterparty = counterparties.create({ name: 'イオン' })
    createRule({ counterpartyId: counterparty.id })

    expect(() => counterparties.delete(counterparty.id)).toThrow()
    expect(counterparties.findById(counterparty.id)).not.toBeNull()
  })

  it('精算バッチの相手になっている取引先は、物理削除できない', () => {
    const counterparties = new SqlJsCounterpartyRepository(db)
    const counterparty = counterparties.create({ name: '友人A' })
    new SqlJsSettlementBatchRepository(db).create({
      name: '旅行',
      type: 'expense_splitting',
      counterpartyId: counterparty.id,
    })

    expect(() => counterparties.delete(counterparty.id)).toThrow()
    expect(counterparties.findById(counterparty.id)).not.toBeNull()
  })

  it('定期仕訳ルールで使われているプロジェクトは、物理削除できない', () => {
    const projects = new SqlJsProjectRepository(db)
    const project = projects.create({ name: '沖縄旅行' })
    createRule({ projectId: project.id })

    expect(() => projects.delete(project.id)).toThrow()
    expect(projects.findById(project.id)).not.toBeNull()
  })

  it('定期仕訳ルールで使われている世帯メンバーは、物理削除できない', () => {
    const members = new SqlJsHouseholdMemberRepository(db)
    createRule({ lineHouseholdMemberId: memberId })

    expect(() => members.delete(memberId)).toThrow()
    expect(members.findById(memberId)).not.toBeNull()
  })

  it('仕訳の起票者になっている世帯メンバーは、物理削除できない', () => {
    const members = new SqlJsHouseholdMemberRepository(db)
    new SqlJsJournalEntryRepository(db).create({
      entryDate: '2026-11-01',
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 1000 },
        { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() => members.delete(memberId)).toThrow()
    expect(members.findById(memberId)).not.toBeNull()
  })

  it('科目の名義になっている世帯メンバーは、物理削除できない', () => {
    const members = new SqlJsHouseholdMemberRepository(db)
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true, householdMemberId: memberId })

    expect(() => members.delete(memberId)).toThrow()
    expect(members.findById(memberId)).not.toBeNull()
  })

  it('何にも使われていない取引先・プロジェクト・世帯メンバーは、物理削除できる', () => {
    const counterparties = new SqlJsCounterpartyRepository(db)
    const projects = new SqlJsProjectRepository(db)
    const members = new SqlJsHouseholdMemberRepository(db)
    const counterparty = counterparties.create({ name: 'イオン' })
    const project = projects.create({ name: '沖縄旅行' })

    counterparties.delete(counterparty.id)
    projects.delete(project.id)
    members.delete(memberId)

    expect(counterparties.findById(counterparty.id)).toBeNull()
    expect(projects.findById(project.id)).toBeNull()
    expect(members.findById(memberId)).toBeNull()
  })
})
