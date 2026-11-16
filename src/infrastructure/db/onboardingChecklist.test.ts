/**
 * 「はじめのチェックリスト」のDB処理のテスト(計画Issue #177、承認済みモックアップ③)。
 * 初回セットアップを済ませた利用者にだけ出し(スキップした人・既存の利用者には出さない)、各項目の達成は
 * DBの状態から求める(口座の科目を登録した・世帯メンバーを追加した・最初の仕訳を記録した)。バックアップだけは
 * 状態から分からないので、利用者が済みにする。「閉じる」か、必須の項目がすべて済むと、以後は出さない。
 * 完了・閉じるの印はseed_markersに持つ(保存先を切り替えても食い違わない)。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import {
  completeOnboarding,
  dismissOnboardingChecklist,
  getOnboardingChecklist,
  markChecklistBackupDone,
  seedOnboardingMarker,
  skipOnboarding,
} from './onboarding'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { seedAdvanceAccounts } from './seedAdvanceAccounts'
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedDefaultAccounts } from './seedDefaultAccounts'
import { seedDefaultHouseholdMember } from './seedDefaultHouseholdMember'
import { seedInitialBalanceAccount } from './seedInitialBalanceAccount'
import { seedSettlementAdjustmentAccounts } from './seedSettlementAdjustmentAccounts'
import { seedStandardAccountGroups } from './seedStandardAccountGroups'

let db: Database
let accounts: SqlJsAccountRepository
let members: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedDefaultHouseholdMember(db)
  seedDefaultAccounts(db)
  seedAdvanceAccounts(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  seedSettlementAdjustmentAccounts(db)
  seedStandardAccountGroups(db)
  seedOnboardingMarker(db)
  accounts = new SqlJsAccountRepository(db)
  members = new SqlJsHouseholdMemberRepository(db)
})

function setupDone(template: 'minimal' | 'standard' | 'bookkeeping' = 'standard') {
  completeOnboarding(db, { memberName: '太郎', template })
}

function recordEntry(sourceType: 'manual' | 'initial_balance') {
  const memberId = members.findAll()[0].id
  const cash = accounts.findAll().find((a) => a.name === '現金')!
  const food = accounts.findAll().find((a) => a.name === '食費')!
  new SqlJsJournalEntryRepository(db).create({
    entryDate: '2026-11-01',
    memo: '昼食',
    sourceType,
    householdMemberId: memberId,
    lines: [
      { accountId: food.id, side: 'debit', amount: 800, householdMemberId: memberId },
      { accountId: cash.id, side: 'credit', amount: 800, householdMemberId: memberId },
    ],
  })
}

describe('getOnboardingChecklist', () => {
  it('初回セットアップを済ませた直後は表示し、どの項目も未達成で、入った科目の件数と名前を返す', () => {
    setupDone()

    const checklist = getOnboardingChecklist(db)

    expect(checklist.visible).toBe(true)
    expect(checklist.memberName).toBe('太郎')
    expect(checklist.accountCounts).toEqual({ revenue: 3, expense: 13 })
    expect(checklist.steps).toEqual({ registerAccount: false, addMember: false, firstEntry: false, backup: false })
  })

  it('科目の件数は、システムが常に入れる科目(雑収入・雑損失・残高調整)を除いて数える', () => {
    setupDone('minimal')

    expect(getOnboardingChecklist(db).accountCounts).toEqual({ revenue: 2, expense: 6 })
  })

  it('スキップした利用者・初回セットアップを出さなかった既存の利用者には表示しない', () => {
    skipOnboarding(db)

    expect(getOnboardingChecklist(db).visible).toBe(false)
  })

  it('初回セットアップ前(未完了)は表示しない', () => {
    expect(getOnboardingChecklist(db).visible).toBe(false)
  })

  it('「現金」以外の資産・負債の科目を登録すると、「口座の科目を登録」が済みになる', () => {
    setupDone()
    expect(getOnboardingChecklist(db).steps.registerAccount).toBe(false)

    accounts.create({ category: 'liability', name: '楽天カード', isReconcilable: false })

    expect(getOnboardingChecklist(db).steps.registerAccount).toBe(true)
  })

  it('個人の世帯メンバーを1人追加すると「世帯メンバーを追加」が済みになる。グループだけでは済みにならない', () => {
    setupDone()
    members.create({ name: '夫婦', isGroup: true })
    expect(getOnboardingChecklist(db).steps.addMember).toBe(false)

    members.create({ name: '花子' })

    expect(getOnboardingChecklist(db).steps.addMember).toBe(true)
  })

  it('手入力などの仕訳を記録すると「最初の仕訳を記録」が済みになる', () => {
    setupDone()

    recordEntry('manual')

    expect(getOnboardingChecklist(db).steps.firstEntry).toBe(true)
  })

  it('口座の最初の残高から自動で入る仕訳(初期残高)だけでは、「最初の仕訳を記録」は済みにならない', () => {
    setupDone()

    recordEntry('initial_balance')

    expect(getOnboardingChecklist(db).steps.firstEntry).toBe(false)
  })

  it('バックアップは、利用者が済みにしたときだけ済みになる', () => {
    setupDone()
    expect(getOnboardingChecklist(db).steps.backup).toBe(false)

    markChecklistBackupDone(db)

    expect(getOnboardingChecklist(db).steps.backup).toBe(true)
  })

  it('「閉じる」と、以後は表示しない(あとで項目が変わっても出さない)', () => {
    setupDone()

    dismissOnboardingChecklist(db)
    accounts.create({ category: 'asset', name: '三菱UFJ銀行', isReconcilable: true })

    expect(getOnboardingChecklist(db).visible).toBe(false)
  })

  it('必須の項目(口座の科目・最初の仕訳・バックアップ)がすべて済むと、表示しなくなる。世帯メンバーの追加は任意', () => {
    setupDone()
    accounts.create({ category: 'liability', name: '楽天カード', isReconcilable: false })
    recordEntry('manual')
    expect(getOnboardingChecklist(db).visible).toBe(true)

    markChecklistBackupDone(db)

    const checklist = getOnboardingChecklist(db)
    expect(checklist.steps.addMember).toBe(false)
    expect(checklist.visible).toBe(false)
  })
})
