// @vitest-environment jsdom
/**
 * AccountMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「勘定科目」タブ: 区分の見出し・グループ・科目のツリー表示、右パネルでの
 * 名称・所属グループ・名義・並び順の編集、グループの新設、科目の新規登録(右パネルのフォーム)、
 * 2回押しの削除と、使用中・中に項目があるときの削除不可の理由表示、初期残高の仕訳だけが
 * 紐づく口座の一緒に削除、システム管理科目の制限(区分変更・削除不可)、有効/無効の切り替えを、
 * sql.jsのNode実装(createTestDatabase)を使って確認する。ドラッグ移動の判定はTreeTableの
 * テストで扱う。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsBudgetRepository } from '../../infrastructure/db/SqlJsBudgetRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { AccountMasterTab } from './AccountMasterTab'

let db: Database
let accounts: SqlJsAccountRepository
let groups: SqlJsAccountGroupRepository
let entries: SqlJsJournalEntryRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  accounts = new SqlJsAccountRepository(db)
  groups = new SqlJsAccountGroupRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <AccountMasterTab
        accountRepository={accounts}
        accountGroupRepository={groups}
        householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
        journalEntryRepository={entries}
        budgetRepository={new SqlJsBudgetRepository(db)}
        recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
        today="2026-11-07"
      />
    </I18nextProvider>,
  )
}

/** 借方・貸方の2行の仕訳を1件登録する */
function postEntry(debitId: number, creditId: number, sourceType: 'manual' | 'initial_balance' = 'manual') {
  return entries.create({
    entryDate: '2026-11-01',
    sourceType,
    householdMemberId: memberId,
    lines: [
      { accountId: debitId, side: 'debit', amount: 1000 },
      { accountId: creditId, side: 'credit', amount: 1000 },
    ],
  })
}

const panel = (name: string) => within(screen.getByRole('region', { name }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('AccountMasterTab', () => {
  it('区分の見出しの下に、グループと科目がツリーで表示される', async () => {
    const group = groups.create({ name: '普通預金', category: 'asset' })
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true, accountGroupId: group.id })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })

    renderTab()

    expect(await screen.findByText('資産')).toBeInTheDocument()
    expect(screen.getByText('費用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '普通預金' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '楽天銀行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '食費' })).toBeInTheDocument()
  })

  it('科目を選ぶと、右パネルに名称・区分・所属グループが表示される', async () => {
    const group = groups.create({ name: '普通預金', category: 'asset' })
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true, accountGroupId: group.id })
    renderTab()

    await open('楽天銀行')

    const editor = panel('科目の編集')
    expect(editor.getByLabelText('名称')).toHaveValue('楽天銀行')
    expect(editor.getByText('資産')).toBeInTheDocument()
    expect(editor.getByLabelText('所属グループ')).toHaveDisplayValue('普通預金')
  })

  it('名称を変えて保存すると、DBに反映される', async () => {
    const account = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    await open('食費')

    fireEvent.change(panel('科目の編集').getByLabelText('名称'), { target: { value: '食料費' } })
    fireEvent.click(panel('科目の編集').getByRole('button', { name: '保存' }))

    await waitFor(() => expect(accounts.findById(account.id)!.name).toBe('食料費'))
    expect(await screen.findByRole('button', { name: '食料費' })).toBeInTheDocument()
  })

  it('同じ区分の別の科目と同じ名前に変えて保存しようとすると、エラーを表示し、名称は変わらない', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    const other = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    renderTab()
    await open('交通費')

    fireEvent.change(panel('科目の編集').getByLabelText('名称'), { target: { value: '食費' } })
    fireEvent.click(panel('科目の編集').getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました')
    expect(accounts.findById(other.id)!.name).toBe('交通費')
  })

  it('名義を選んで保存すると、DBに反映される', async () => {
    const account = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
    renderTab()
    await open('現金')

    fireEvent.change(panel('科目の編集').getByLabelText('名義'), { target: { value: String(memberId) } })
    fireEvent.click(panel('科目の編集').getByRole('button', { name: '保存' }))

    await waitFor(() => expect(accounts.findById(account.id)!.householdMemberId).toBe(memberId))
  })

  it('所属グループを選び直すと、すぐに別のグループへ移る', async () => {
    const bank = groups.create({ name: '普通預金', category: 'asset' })
    const cash = groups.create({ name: '現金・電子マネー', category: 'asset' })
    const account = accounts.create({
      category: 'asset',
      name: '楽天銀行',
      isReconcilable: true,
      accountGroupId: bank.id,
    })
    renderTab()
    await open('楽天銀行')

    fireEvent.change(panel('科目の編集').getByLabelText('所属グループ'), { target: { value: `g:${cash.id}` } })

    await waitFor(() => expect(accounts.findById(account.id)!.accountGroupId).toBe(cash.id))
  })

  it('所属グループの選択肢には、同じ区分のグループだけが並ぶ', async () => {
    groups.create({ name: '普通預金', category: 'asset' })
    groups.create({ name: 'クレジットカード', category: 'liability' })
    accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
    renderTab()
    await open('現金')

    const select = panel('科目の編集').getByLabelText('所属グループ')

    expect(within(select).getByRole('option', { name: /普通預金/ })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: /クレジットカード/ })).not.toBeInTheDocument()
  })

  it('「下へ」で並び順が入れ替わる', async () => {
    const first = accounts.create({ category: 'expense', name: '食費', isReconcilable: null, sortOrder: 0 })
    const second = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null, sortOrder: 1 })
    renderTab()
    await open('食費')

    fireEvent.click(panel('科目の編集').getByRole('button', { name: '下へ' }))

    await waitFor(() => expect(accounts.findById(first.id)!.sortOrder).toBe(1))
    expect(accounts.findById(second.id)!.sortOrder).toBe(0)
  })

  it('区分の見出しの「グループを追加」で、その区分にグループが作られ、編集パネルが開く', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: '資産にグループを追加' }))

    await waitFor(() => expect(groups.findAll()).toHaveLength(1))
    expect(groups.findAll()[0]).toMatchObject({ category: 'asset', parentGroupId: null })
    expect(await screen.findByRole('region', { name: 'グループの編集' })).toBeInTheDocument()
  })

  it('区分の見出しの「科目を追加」で登録フォームが右パネルに開き、登録すると一覧に出る', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: '費用に科目を追加' }))
    const form = within(await screen.findByRole('form', { name: '科目を登録' }))
    expect(form.getByLabelText('区分')).toHaveDisplayValue('費用')
    fireEvent.change(form.getByLabelText('名称'), { target: { value: '食費' } })
    fireEvent.click(form.getByRole('button', { name: '登録' }))

    expect(await screen.findByRole('button', { name: '食費' })).toBeInTheDocument()
    expect(accounts.findAll().some((a) => a.name === '食費')).toBe(true)
  })

  it('資本の見出しには「科目を追加」が無い', async () => {
    renderTab()

    await screen.findByText('資本')

    expect(screen.queryByRole('button', { name: '資本に科目を追加' })).not.toBeInTheDocument()
  })

  it('使われていない科目は、「削除」を2回押すと削除される', async () => {
    const account = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    await open('食費')

    fireEvent.click(panel('科目の編集').getByRole('button', { name: '削除' }))
    expect(accounts.findById(account.id)).not.toBeNull()
    fireEvent.click(panel('科目の編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(accounts.findById(account.id)).toBeNull())
  })

  it('仕訳で使用中の科目は、削除ボタンが押せず、使用中の理由が表示される', async () => {
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
    postEntry(food.id, cash.id)
    renderTab()
    await open('食費')

    const editor = panel('科目の編集')

    expect(editor.getByRole('button', { name: '削除' })).toBeDisabled()
    expect(editor.getByText(/仕訳の明細1行で使用中のため削除できません/)).toBeInTheDocument()
  })

  it('予算と定期取引ルールで使用中の科目も、その理由が表示される', async () => {
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
    new SqlJsBudgetRepository(db).create({ accountId: food.id, yearMonth: '2026-11', amount: 50000 })
    new SqlJsRecurringTransactionRuleRepository(db).create({
      name: '毎月の食費',
      debitAccountId: food.id,
      creditAccountId: cash.id,
      amount: 1000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    renderTab()
    await open('食費')

    const editor = panel('科目の編集')

    expect(editor.getByText(/予算1件/)).toBeInTheDocument()
    expect(editor.getByText(/定期取引ルール1件/)).toBeInTheDocument()
  })

  it('初期残高の仕訳だけが紐づく口座は、確認の文言でその旨が伝わり、仕訳と一緒に削除される', async () => {
    const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
    const initial = accounts.findAll().find((a) => a.isSystemManaged)!
    const entry = postEntry(bank.id, initial.id, 'initial_balance')
    renderTab()
    await open('楽天銀行')

    fireEvent.click(panel('科目の編集').getByRole('button', { name: '削除' }))
    expect(panel('科目の編集').getByText(/初期残高の仕訳も一緒に削除します/)).toBeInTheDocument()
    fireEvent.click(panel('科目の編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(accounts.findById(bank.id)).toBeNull())
    expect(entries.findAll().some((e) => e.id === entry.id)).toBe(false)
  })

  it('初期残高の仕訳のほかに通常の仕訳がある口座は、削除できない', async () => {
    const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: false })
    const initial = accounts.findAll().find((a) => a.isSystemManaged)!
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    postEntry(bank.id, initial.id, 'initial_balance')
    postEntry(food.id, bank.id)
    renderTab()
    await open('楽天銀行')

    expect(panel('科目の編集').getByRole('button', { name: '削除' })).toBeDisabled()
  })

  it('システム管理の科目は、名称は変えられるが、削除と有効/無効の切り替えはできない', async () => {
    renderTab()
    await open('初期残高')

    const editor = panel('科目の編集')

    expect(editor.getByLabelText('名称')).toBeEnabled()
    expect(editor.getByText(/システム管理の科目です/)).toBeInTheDocument()
    expect(editor.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
    expect(editor.queryByRole('button', { name: '無効にする' })).not.toBeInTheDocument()
  })

  it('科目を「無効にする」と、DBで無効になり、「有効にする」で戻る', async () => {
    const account = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    await open('食費')

    fireEvent.click(panel('科目の編集').getByRole('button', { name: '無効にする' }))
    await waitFor(() => expect(accounts.findById(account.id)!.isActive).toBe(false))

    fireEvent.click(await panel('科目の編集').findByRole('button', { name: '有効にする' }))
    await waitFor(() => expect(accounts.findById(account.id)!.isActive).toBe(true))
  })

  it('中に項目があるグループは、削除ボタンが押せず、理由が表示される', async () => {
    const group = groups.create({ name: '普通預金', category: 'asset' })
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true, accountGroupId: group.id })
    renderTab()
    await open('普通預金')

    const editor = panel('グループの編集')

    expect(editor.getByRole('button', { name: 'グループを削除' })).toBeDisabled()
    expect(editor.getByText(/中の項目を移動すると削除できます/)).toBeInTheDocument()
  })

  it('空のグループは、「グループを削除」を2回押すと削除される', async () => {
    const group = groups.create({ name: '空のグループ', category: 'asset' })
    renderTab()
    await open('空のグループ')

    fireEvent.click(panel('グループの編集').getByRole('button', { name: 'グループを削除' }))
    fireEvent.click(panel('グループの編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(groups.findById(group.id)).toBeNull())
  })
})
