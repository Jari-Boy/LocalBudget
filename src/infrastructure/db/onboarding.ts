import type { Database } from 'sql.js'
import {
  ACCOUNT_TEMPLATES,
  CASH_ACCOUNT_NAME,
  PROTECTED_REVENUE_EXPENSE_NAMES,
  type AccountTemplateKey,
} from '../../domain/onboarding/accountTemplates'
import type { AccountCategory } from '../../domain/account/Account'
import seedMarkersSql from '../../../docs/schema/seed_markers.sql?raw'
import { SqlJsAccountGroupRepository } from './SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'

/** seed_markersに残す、初回セットアップ(オンボーディング)が済んだことの印の名前(計画Issue #177) */
export const ONBOARDING_MARKER = 'onboarding_completed'

/** 「現金」が所属する標準グループの名前(seedStandardAccountGroups) */
const CASH_GROUP_NAME = '現金・電子マネー'

export interface CompleteOnboardingInput {
  memberName: string
  template: AccountTemplateKey
}

/** 初回セットアップの完了を、DBの状態として持つ。保存先(ブラウザ内/フォルダ)を切り替えても、DBの中身が正になる。 */
export function isOnboardingCompleted(db: Database): boolean {
  db.run(seedMarkersSql)
  const [marked] = db.exec('SELECT 1 FROM seed_markers WHERE name = ?', [ONBOARDING_MARKER])
  return marked !== undefined
}

function markCompleted(db: Database): void {
  db.run(seedMarkersSql)
  db.run('INSERT OR IGNORE INTO seed_markers (name) VALUES (?)', [ONBOARDING_MARKER])
}

/**
 * Worker起動時に、初回セットアップを出すかどうかを一度だけ判定する(計画Issue #177)。
 * 利用者が登録した資産・負債の科目か、仕訳が既にあるDBは「既存の利用者」なので、完了済みの印を付けて
 * セットアップを出さない。どちらも無い新規DBは印を付けず、初回セットアップの対象にする。
 * 起動時の自動投入(世帯メンバー・標準科目・システム管理科目)は、利用者のデータとはみなさない。
 * 印は一度付いたら消えない(あとでデータが無くなっても、セットアップは出さない)。
 * 開発用サンプルデータ(seedDevSampleDataIfDev)を入れた後に呼ぶと、開発モードでは完了済みになる。
 */
export function seedOnboardingMarker(db: Database): void {
  if (isOnboardingCompleted(db)) return

  const hasUserBalanceSheetAccount = new SqlJsAccountRepository(db)
    .findAll()
    .some(
      (account) =>
        !account.isSystemManaged && (account.category === 'asset' || account.category === 'liability'),
    )
  const [journalCount] = db.exec('SELECT 1 FROM journal_entries LIMIT 1')
  if (hasUserBalanceSheetAccount || journalCount !== undefined) markCompleted(db)
}

/** 何も変えずに、初回セットアップを済んだことにする(「スキップ」)。 */
export function skipOnboarding(db: Database): void {
  markCompleted(db)
}

/**
 * 初回セットアップを確定する(計画Issue #177)。次を順に行う。外側のトランザクションは張らない
 * (SqlJsAccountRepository.deleteが自前でBEGINするためネストできない)。代わりに各手順を冪等にし、完了の印を
 * 最後に付ける。途中で失敗しても印が付かないので、やり直せば同じ結果になる。
 * 1. 最初の世帯メンバー(起動時に自動投入された1件)の名前を、入力した名前にする
 * 2. 収益・費用の科目を、選んだテンプレートに合わせる(テンプレートに無い自動投入の科目は消し、足りない科目を足す。
 *    雑収入・雑損失は残す。この時点では仕訳が無いので削除できる)
 * 3. 資産の「現金」を入れる(外部明細なし・標準グループ「現金・電子マネー」)
 * 4. 完了済みの印を付ける
 * 既に完了済みなら何もしない(あとから名前や科目を書き換えない)。
 */
export function completeOnboarding(db: Database, input: CompleteOnboardingInput): void {
  const memberName = input.memberName.trim()
  if (memberName === '') throw new Error('世帯メンバーの名前が空です')
  if (isOnboardingCompleted(db)) return

  applyMemberName(db, memberName)
  applyTemplate(db, input.template)
  ensureCashAccount(db)
  markCompleted(db)
}

function applyMemberName(db: Database, name: string): void {
  const members = new SqlJsHouseholdMemberRepository(db)
  const first = members.findAll().find((member) => !member.isGroup)
  if (first) members.update(first.id, { name })
  else members.create({ name })
}

function applyTemplate(db: Database, key: AccountTemplateKey): void {
  const accounts = new SqlJsAccountRepository(db)
  const template = ACCOUNT_TEMPLATES[key]
  const wanted: ReadonlyArray<readonly [AccountCategory, readonly string[]]> = [
    ['revenue', template.revenue],
    ['expense', template.expense],
  ]

  for (const [category, names] of wanted) {
    const existing = accounts.findAll().filter((account) => account.category === category)
    for (const account of existing) {
      if (account.isSystemManaged || PROTECTED_REVENUE_EXPENSE_NAMES.includes(account.name)) continue
      if (!names.includes(account.name)) accounts.delete(account.id)
    }
    const remaining = new Set(accounts.findAll().filter((a) => a.category === category).map((a) => a.name))
    for (const name of names) {
      if (!remaining.has(name)) accounts.create({ category, name, isReconcilable: null })
    }
  }
}

function ensureCashAccount(db: Database): void {
  const accounts = new SqlJsAccountRepository(db)
  if (accounts.findAll().some((a) => a.category === 'asset' && a.name === CASH_ACCOUNT_NAME)) return

  const group = new SqlJsAccountGroupRepository(db)
    .findAll()
    .find((g) => g.category === 'asset' && g.name === CASH_GROUP_NAME)
  accounts.create({
    category: 'asset',
    name: CASH_ACCOUNT_NAME,
    isReconcilable: false,
    hasExternalStatement: false,
    accountGroupId: group?.id ?? null,
  })
}
