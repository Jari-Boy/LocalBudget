/**
 * 初回セットアップ(オンボーディング)のDB処理のテスト(計画Issue #177)。
 * 完了の印はseed_markersに持つ(DBの状態が正で、保存先を切り替えても食い違わない)。
 * - seedOnboardingMarker: 起動時に呼ぶ。利用者のデータが既にあるDBには完了の印を付け、新規DBには付けない
 * - completeOnboarding: 入力した名前で最初の世帯メンバーを直し、テンプレートに合わせて収益・費用の科目を整え、
 *   資産の「現金」を入れて、完了の印を付ける
 * - skipOnboarding: 何も変えず、完了の印だけ付ける
 * 外部依存: sql.js(ネットワークアクセスなし)。起動時のseedはdb.worker.tsと同じ順で呼ぶ。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import {
  completeOnboarding,
  getOnboardingChecklist,
  isOnboardingCompleted,
  seedOnboardingMarker,
  skipOnboarding,
} from './onboarding'
import { SqlJsAccountGroupRepository } from './SqlJsAccountGroupRepository'
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

/** 新規DBの起動時と同じseed(db.worker.tsの順) */
function seedLikeStartup(target: Database) {
  seedDefaultHouseholdMember(target)
  seedDefaultAccounts(target)
  seedAdvanceAccounts(target)
  seedInitialBalanceAccount(target)
  seedBalanceAdjustmentAccount(target)
  seedSettlementAdjustmentAccounts(target)
  seedStandardAccountGroups(target)
}

function namesOf(category: 'asset' | 'revenue' | 'expense') {
  return accounts
    .findAll()
    .filter((a) => a.category === category)
    .map((a) => a.name)
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accounts = new SqlJsAccountRepository(db)
  members = new SqlJsHouseholdMemberRepository(db)
})

describe('seedOnboardingMarker', () => {
  it('新規DB(利用者のデータが無い)では、完了の印を付けず、未完了のままにする', () => {
    seedLikeStartup(db)
    seedOnboardingMarker(db)

    expect(isOnboardingCompleted(db)).toBe(false)
  })

  it('利用者が登録した口座(資産・負債の科目)があるDBは、既存利用者として完了済みにする', () => {
    seedLikeStartup(db)
    accounts.create({ category: 'asset', name: '三菱UFJ銀行', isReconcilable: true })

    seedOnboardingMarker(db)

    expect(isOnboardingCompleted(db)).toBe(true)
  })

  it('仕訳があるDBは、既存利用者として完了済みにする', () => {
    seedLikeStartup(db)
    const cash = accounts.create({ category: 'asset', name: '財布', isReconcilable: false })
    const food = accounts.findAll().find((a) => a.name === '食費')!
    const member = members.findAll()[0]
    new SqlJsJournalEntryRepository(db).create({
      entryDate: '2026-11-01',
      memo: '昼食',
      householdMemberId: member.id,
      lines: [
        { accountId: food.id, side: 'debit', amount: 800, householdMemberId: member.id },
        { accountId: cash.id, side: 'credit', amount: 800, householdMemberId: member.id },
      ],
    })

    seedOnboardingMarker(db)

    expect(isOnboardingCompleted(db)).toBe(true)
  })

  it('システム管理の科目と標準科目しか無い新規DBは、2回呼んでも未完了のまま(冪等)', () => {
    seedLikeStartup(db)
    seedOnboardingMarker(db)
    seedOnboardingMarker(db)

    expect(isOnboardingCompleted(db)).toBe(false)
  })

  it('一度完了済みにしたDBは、あとでデータが無くなっても未完了に戻らない', () => {
    seedLikeStartup(db)
    const bank = accounts.create({ category: 'asset', name: '三菱UFJ銀行', isReconcilable: true })
    seedOnboardingMarker(db)
    accounts.delete(bank.id)

    seedOnboardingMarker(db)

    expect(isOnboardingCompleted(db)).toBe(true)
  })
})

describe('completeOnboarding', () => {
  beforeEach(() => {
    seedLikeStartup(db)
    seedOnboardingMarker(db)
  })

  it('入力した名前で、最初の世帯メンバー(自動投入の「自分」)の名前を直す', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'standard' })

    expect(members.findAll().map((m) => m.name)).toEqual(['太郎'])
  })

  it('名前の前後の空白は取り除いて保存する', () => {
    completeOnboarding(db, { memberName: '  花子 ', template: 'standard' })

    expect(members.findAll()[0].name).toBe('花子')
  })

  it('名前が空(空白のみを含む)のときは、何も変えずに失敗する', () => {
    expect(() => completeOnboarding(db, { memberName: '   ', template: 'standard' })).toThrow()

    expect(members.findAll()[0].name).toBe('自分')
    expect(isOnboardingCompleted(db)).toBe(false)
  })

  it('標準テンプレートでは、収益3件・費用13件になり、自動投入にあった「謝礼収入」は無くなる', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'standard' })

    expect(namesOf('revenue').filter((n) => n !== '雑収入')).toEqual(['給与収入', '副業収入', 'その他収入'])
    expect(namesOf('expense').filter((n) => !['雑損失', '残高調整'].includes(n))).toHaveLength(13)
  })

  it('最小テンプレートでは、収益・費用が少ない構成になる', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'minimal' })

    expect(namesOf('revenue')).not.toContain('副業収入')
    expect(namesOf('expense')).not.toContain('医療費')
    expect(namesOf('expense')).toContain('食費')
  })

  it('簿記寄りテンプレートでは、税・社会保険・利息などの科目が増える', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'bookkeeping' })

    expect(namesOf('expense')).toEqual(expect.arrayContaining(['所得税', '住民税', '社会保険料', '支払利息']))
    expect(namesOf('revenue')).toEqual(expect.arrayContaining(['賞与', '事業収入', '利息・配当']))
  })

  it('テンプレートに関わらず、システムが常に入れる科目(雑収入・雑損失)は残る', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'minimal' })

    expect(namesOf('revenue')).toContain('雑収入')
    expect(namesOf('expense')).toContain('雑損失')
  })

  it('資産の「現金」を、資産・負債を持たないモックアップどおり最初から1件入れる(外部明細なし)', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'standard' })

    const cash = accounts.findAll().filter((a) => a.name === '現金')
    expect(cash).toHaveLength(1)
    expect(cash[0]).toMatchObject({ category: 'asset', isReconcilable: false, hasExternalStatement: false })
  })

  it('「現金」は標準グループ「現金・電子マネー」に所属させる', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'standard' })

    const group = new SqlJsAccountGroupRepository(db).findAll().find((g) => g.name === '現金・電子マネー')!
    const cash = accounts.findAll().find((a) => a.name === '現金')!
    expect(cash.accountGroupId).toBe(group.id)
  })

  it('「現金」という資産が既にあるときは、重複して作らない', () => {
    accounts.create({ category: 'asset', name: '現金', isReconcilable: false })

    completeOnboarding(db, { memberName: '太郎', template: 'standard' })

    expect(accounts.findAll().filter((a) => a.name === '現金')).toHaveLength(1)
  })

  it('完了すると完了済みになり、2回目の呼び出しは何も変えない', () => {
    completeOnboarding(db, { memberName: '太郎', template: 'standard' })
    completeOnboarding(db, { memberName: '次郎', template: 'minimal' })

    expect(isOnboardingCompleted(db)).toBe(true)
    expect(members.findAll().map((m) => m.name)).toEqual(['太郎'])
    expect(namesOf('expense')).toContain('医療費')
  })
})

describe('読み取り(自動保存を予約しない)', () => {
  it('完了の判定とチェックリストの取得は、DBを書き換える文(db.run)を実行しない', () => {
    // 自動保存(withAutoSave)はdb.run()をすべて変更とみなして保存を予約する。画面を開くだけの読み取りで
    // 保存が走ると、別のタブ・Workerが書いたデータを古いDBで上書きしうる(E2Eで発覚、計画Issue #177)
    seedLikeStartup(db)
    seedOnboardingMarker(db)
    completeOnboarding(db, { memberName: '太郎', template: 'standard' })
    const originalRun = db.run.bind(db)
    const runCalls: string[] = []
    db.run = ((sql: string, params?: unknown) => {
      runCalls.push(sql)
      return originalRun(sql, params as never)
    }) as Database['run']

    isOnboardingCompleted(db)
    getOnboardingChecklist(db)

    expect(runCalls).toEqual([])
  })
})

describe('skipOnboarding', () => {
  it('名前も科目も変えず、完了済みにだけする', () => {
    seedLikeStartup(db)
    seedOnboardingMarker(db)
    const before = accounts.findAll().map((a) => a.name)

    skipOnboarding(db)

    expect(isOnboardingCompleted(db)).toBe(true)
    expect(members.findAll()[0].name).toBe('自分')
    expect(accounts.findAll().map((a) => a.name)).toEqual(before)
  })
})
