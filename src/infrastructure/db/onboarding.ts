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

/** 初回セットアップを済ませた利用者に「はじめのチェックリスト」を出すことの印(計画Issue #177)。閉じる・全項目の達成で消す */
export const ONBOARDING_CHECKLIST_MARKER = 'onboarding_checklist'
/** チェックリストの「バックアップを1度取る」を、利用者が済みにしたことの印 */
const ONBOARDING_BACKUP_MARKER = 'onboarding_backup_done'

/** 「現金」が所属する標準グループの名前(seedStandardAccountGroups) */
const CASH_GROUP_NAME = '現金・電子マネー'

export interface CompleteOnboardingInput {
  memberName: string
  template: AccountTemplateKey
}

/** 初回セットアップの完了を、DBの状態として持つ。保存先(ブラウザ内/フォルダ)を切り替えても、DBの中身が正になる。 */
export function isOnboardingCompleted(db: Database): boolean {
  return hasMarker(db, ONBOARDING_MARKER)
}

/**
 * 印の有無を読む。読み取りでは`db.run`を呼ばない(表の作成も含めて)。自動保存(withAutoSave)は`db.run`を
 * すべて変更とみなして保存を予約するため、画面を開くだけの読み取りで保存が走り、別のタブ・Workerが書いた
 * データを古いDBで上書きしうるため(E2Eで発覚、計画Issue #177)。表は、最新スキーマと、起動時の
 * seedStandardAccountGroups・seedOnboardingMarker(どちらも自動保存の開始前)が必ず作る。
 */
function hasMarker(db: Database, name: string): boolean {
  const [marked] = db.exec('SELECT 1 FROM seed_markers WHERE name = ?', [name])
  return marked !== undefined
}

function putMarker(db: Database, name: string): void {
  db.run(seedMarkersSql)
  db.run('INSERT OR IGNORE INTO seed_markers (name) VALUES (?)', [name])
}

function markCompleted(db: Database): void {
  putMarker(db, ONBOARDING_MARKER)
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
  db.run(seedMarkersSql)
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
  // チェックリストの印は、完了の印より先に付ける(途中で失敗しても、完了の印が無ければやり直せる)
  putMarker(db, ONBOARDING_CHECKLIST_MARKER)
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

export interface OnboardingChecklist {
  /** 表示するか。セットアップを済ませた利用者のうち、閉じていない・必須の項目が残っている間だけtrue */
  visible: boolean
  /** 最初の世帯メンバーの名前(「いまは○○の1名です」の表示用) */
  memberName: string | null
  /** 入った収益・費用の科目の件数(システムが常に入れる雑収入・雑損失・残高調整は除く) */
  accountCounts: { revenue: number; expense: number }
  steps: {
    /** 「現金」以外の資産・負債の科目(口座・クレジットカード)を登録した */
    registerAccount: boolean
    /** 個人の世帯メンバーを追加した(任意の項目) */
    addMember: boolean
    /** 手入力・明細取込などの仕訳を記録した(口座の最初の残高から自動で入る仕訳は数えない) */
    firstEntry: boolean
    /** バックアップを取ったと、利用者が済みにした */
    backup: boolean
  }
}

/** 自動で入る仕訳(口座の最初の残高と残高調整)。「最初の仕訳を記録」には数えない */
const AUTOMATIC_SOURCE_TYPES = ['initial_balance', 'balance_adjustment']

/**
 * 「はじめのチェックリスト」の表示と各項目の達成を、DBの状態から求める(計画Issue #177、承認済みモックアップ③)。
 * 表示するのは、初回セットアップを済ませた(スキップしていない)利用者が、まだ閉じておらず、必須の項目
 * (口座の科目の登録・最初の仕訳・バックアップ)が残っている間だけ。世帯メンバーの追加は任意なので、
 * 済んでいなくても表示の判定には使わない。
 */
export function getOnboardingChecklist(db: Database): OnboardingChecklist {
  const accounts = new SqlJsAccountRepository(db).findAll()
  const members = new SqlJsHouseholdMemberRepository(db).findAll()

  const registerAccount = accounts.some(
    (account) =>
      !account.isSystemManaged &&
      (account.category === 'asset' || account.category === 'liability') &&
      account.name !== CASH_ACCOUNT_NAME,
  )
  const individuals = members.filter((member) => !member.isGroup)
  const placeholders = AUTOMATIC_SOURCE_TYPES.map(() => '?').join(', ')
  const [entry] = db.exec(
    `SELECT 1 FROM journal_entries WHERE source_type NOT IN (${placeholders}) LIMIT 1`,
    AUTOMATIC_SOURCE_TYPES,
  )
  const steps = {
    registerAccount,
    addMember: individuals.length > 1,
    firstEntry: entry !== undefined,
    backup: hasMarker(db, ONBOARDING_BACKUP_MARKER),
  }
  const countOf = (category: 'revenue' | 'expense') =>
    accounts.filter(
      (account) => account.category === category && !PROTECTED_REVENUE_EXPENSE_NAMES.includes(account.name) && account.name !== '残高調整',
    ).length

  return {
    visible:
      hasMarker(db, ONBOARDING_CHECKLIST_MARKER) && !(steps.registerAccount && steps.firstEntry && steps.backup),
    memberName: individuals[0]?.name ?? null,
    accountCounts: { revenue: countOf('revenue'), expense: countOf('expense') },
    steps,
  }
}

/** 「チェックリストを閉じる」。以後は表示しない。 */
export function dismissOnboardingChecklist(db: Database): void {
  db.run(seedMarkersSql)
  db.run('DELETE FROM seed_markers WHERE name = ?', [ONBOARDING_CHECKLIST_MARKER])
}

/** 「バックアップを1度取る」を、利用者が済みにする。 */
export function markChecklistBackupDone(db: Database): void {
  putMarker(db, ONBOARDING_BACKUP_MARKER)
}
