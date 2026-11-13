// @vitest-environment jsdom
/**
 * AccountMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「勘定科目」タブ: 区分の見出し・グループ・科目のツリー表示、右パネルでの
 * 名称・所属グループ・名義・並び順の編集、グループの新設、科目の新規登録(右パネルのフォーム)、
 * 2回押しの削除と、使用中・中に項目があるときの削除不可の理由表示、初期残高の仕訳だけが
 * 紐づく口座の一緒に削除、システム管理科目の制限(区分変更・削除不可)、有効/無効の切り替え、
 * 資産・負債科目の右パネルの「登録時の設定」(表示のみ)と「明細マッピング」の紐づけ・解除
 * (計画Issue #189)を、
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
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { AccountMasterTab } from './AccountMasterTab'
import { twoLineRuleLines } from '../../domain/recurring-transaction/twoLineRuleLines'

let db: Database
let accounts: SqlJsAccountRepository
let groups: SqlJsAccountGroupRepository
let entries: SqlJsJournalEntryRepository
let mappings: SqlJsImportMappingDefinitionRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  accounts = new SqlJsAccountRepository(db)
  groups = new SqlJsAccountGroupRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  mappings = new SqlJsImportMappingDefinitionRepository(db)
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
        importMappingDefinitionRepository={mappings}
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
      { householdMemberId: memberId, accountId: debitId, side: 'debit', amount: 1000 },
      { householdMemberId: memberId, accountId: creditId, side: 'credit', amount: 1000 },
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

  describe('既定の世帯メンバーを変えるときの、過去の明細行の扱い(計画Issue #169)', () => {
    /** 現金(既定メンバーなし)に、夫の明細行を1行持つ仕訳を作り、名義を妻に変える操作まで進める */
    async function startChangingToWife() {
      const wifeId = new SqlJsHouseholdMemberRepository(db).create({ name: '妻' }).id
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
      postEntry(food.id, cash.id)
      renderTab()
      await open('現金')
      fireEvent.change(panel('科目の編集').getByLabelText('名義'), { target: { value: String(wifeId) } })
      fireEvent.click(panel('科目の編集').getByRole('button', { name: '保存' }))
      return { wifeId, cash, food }
    }

    const cashLineMember = (cashId: number) =>
      entries.findAll().flatMap((e) => e.lines).find((l) => l.accountId === cashId)!.householdMemberId

    it('名義を変えて保存すると、対象の明細行の件数を示す確認が出て、選ぶまでは何も変わらない', async () => {
      const { cash } = await startChangingToWife()

      const dialog = await screen.findByRole('dialog', { name: '既定の世帯メンバーの変更' })
      expect(dialog).toHaveTextContent('1 件')
      expect(accounts.findById(cash.id)!.householdMemberId).toBeNull()
    })

    it('「過去の明細行も更新する」を選ぶと、科目の名義と過去の明細行がすべて新しい名義になる', async () => {
      const { wifeId, cash } = await startChangingToWife()

      fireEvent.click(await screen.findByRole('button', { name: '変更する' }))

      await waitFor(() => expect(accounts.findById(cash.id)!.householdMemberId).toBe(wifeId))
      expect(cashLineMember(cash.id)).toBe(wifeId)
    })

    it('「そのまま残す」を選ぶと、科目の名義だけが変わり、過去の明細行は旧メンバーのまま残る', async () => {
      const { wifeId, cash } = await startChangingToWife()

      fireEvent.click(await screen.findByRole('radio', { name: /そのまま残す/ }))
      fireEvent.click(screen.getByRole('button', { name: '変更する' }))

      await waitFor(() => expect(accounts.findById(cash.id)!.householdMemberId).toBe(wifeId))
      expect(cashLineMember(cash.id)).toBe(memberId)
    })

    it('キャンセルすると、科目の名義も明細行も変わらない', async () => {
      const { cash } = await startChangingToWife()

      fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(accounts.findById(cash.id)!.householdMemberId).toBeNull()
      expect(cashLineMember(cash.id)).toBe(memberId)
    })

    it('対象の明細行がない科目や、名義を解除する場合は、確認を出さずに保存する', async () => {
      const account = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, householdMemberId: memberId })
      renderTab()
      await open('現金')

      fireEvent.change(panel('科目の編集').getByLabelText('名義'), { target: { value: '' } })
      fireEvent.click(panel('科目の編集').getByRole('button', { name: '保存' }))

      await waitFor(() => expect(accounts.findById(account.id)!.householdMemberId).toBeNull())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
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

  it('予算と定期仕訳ルールで使用中の科目も、その理由が表示される', async () => {
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
    new SqlJsBudgetRepository(db).create({ accountId: food.id, yearMonth: '2026-11', amount: 50000 })
    new SqlJsRecurringTransactionRuleRepository(db).create({
      name: '毎月の食費',
      lines: twoLineRuleLines(food.id, cash.id, 1000),
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    renderTab()
    await open('食費')

    const editor = panel('科目の編集')

    expect(editor.getByText(/予算1件/)).toBeInTheDocument()
    expect(editor.getByText(/定期仕訳ルール1件/)).toBeInTheDocument()
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

  describe('登録時の設定と明細マッピング(計画Issue #189)', () => {
    const SAMPLE = {
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed' as const,
      amountColumn: '2',
    }
    const definition = (label: string, accountIds: number[] = []) =>
      mappings.create({ ...SAMPLE, formatGroupId: '楽天銀行', label, accountIds })

    /** 「外部明細の情報」の1項目(見出しと値のまとまり) */
    const item = (info: ReturnType<typeof panel>, label: string) => within(info.getByText(label).closest('div')!)

    it('外部明細ありで残高情報ありの資産科目は、外部明細・残高情報・初期残高が表示される', async () => {
      const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      postEntry(bank.id, accounts.findAll().find((a) => a.isSystemManaged)!.id, 'initial_balance')
      renderTab()

      await open('楽天銀行')

      const info = panel('外部明細の情報')
      expect(item(info, '外部明細').getByText('あり')).toBeInTheDocument()
      expect(item(info, '残高情報').getByText('あり')).toBeInTheDocument()
      expect(item(info, '初期残高').getByText(/¥1,000/)).toBeInTheDocument()
    })

    it('外部明細あり・残高情報なし(カード未払金)は、外部明細あり・残高情報なしと区別して表示される', async () => {
      accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false, hasExternalStatement: true })
      renderTab()

      await open('カード未払金')

      const info = panel('外部明細の情報')
      expect(item(info, '外部明細').getByText('あり')).toBeInTheDocument()
      expect(item(info, '残高情報').getByText('なし')).toBeInTheDocument()
      expect(item(info, '初期残高').getByText('なし')).toBeInTheDocument()
    })

    it('外部明細なし(現金)は、外部明細なしと表示され、補足の長い文言は出ない', async () => {
      accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
      renderTab()

      await open('現金')

      const info = panel('外部明細の情報')
      expect(item(info, '外部明細').getByText('なし')).toBeInTheDocument()
      expect(info.queryByText(/突き合わせ/)).toBeNull()
      expect(info.queryByText(/保存されていない/)).toBeNull()
    })

    it('外部明細の情報は表示のみで、入力・選択・ボタンを持たない', async () => {
      accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      renderTab()

      await open('楽天銀行')

      const info = panel('外部明細の情報')
      expect(info.queryByRole('textbox')).toBeNull()
      expect(info.queryByRole('combobox')).toBeNull()
      expect(info.queryByRole('button')).toBeNull()
    })

    it('外部明細なしの科目には、明細マッピングの欄が出ない', async () => {
      accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
      renderTab()

      await open('現金')

      expect(screen.queryByRole('region', { name: '明細マッピング' })).toBeNull()
    })

    it('収益・費用の科目とグループでは、外部明細の情報も明細マッピングも表示されない', async () => {
      groups.create({ name: '食費グループ', category: 'expense' })
      accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
      renderTab()

      await open('食費')
      expect(screen.queryByRole('region', { name: '外部明細の情報' })).toBeNull()
      expect(screen.queryByRole('region', { name: '明細マッピング' })).toBeNull()

      await open('食費グループ')
      expect(screen.queryByRole('region', { name: '外部明細の情報' })).toBeNull()
      expect(screen.queryByRole('region', { name: '明細マッピング' })).toBeNull()
    })

    it('紐づいている明細マッピングが一覧で表示され、紐づいていない定義は含まれない', async () => {
      const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      definition('入出金明細', [bank.id])
      definition('別の定義')
      renderTab()

      await open('楽天銀行')

      const list = panel('明細マッピング').getByRole('list')
      expect(list).toHaveTextContent('入出金明細')
      expect(list).not.toHaveTextContent('別の定義')
    })

    it('未紐づけの定義を選んで紐づけると、すぐ中間テーブルに反映され一覧に出る', async () => {
      const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      const target = definition('入出金明細')
      renderTab()
      await open('楽天銀行')

      fireEvent.change(panel('明細マッピング').getByLabelText('紐づける定義'), {
        target: { value: String(target.id) },
      })
      fireEvent.click(panel('明細マッピング').getByRole('button', { name: '紐づける' }))

      await waitFor(() => expect(mappings.findById(target.id)!.accountIds).toEqual([bank.id]))
      expect(await panel('明細マッピング').findByRole('list')).toHaveTextContent('入出金明細')
    })

    it('紐づけると、他の科目との紐づけは影響を受けない', async () => {
      const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      const card = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false })
      const target = definition('共有の定義', [card.id])
      renderTab()
      await open('楽天銀行')

      fireEvent.change(panel('明細マッピング').getByLabelText('紐づける定義'), {
        target: { value: String(target.id) },
      })
      fireEvent.click(panel('明細マッピング').getByRole('button', { name: '紐づける' }))

      await waitFor(() => expect(mappings.findById(target.id)!.accountIds).toEqual([bank.id, card.id]))
    })

    it('紐づけ済みの定義を解除でき、定義・科目そのものと他の科目の紐づけは残る', async () => {
      const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      const card = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false })
      const target = definition('共有の定義', [bank.id, card.id])
      renderTab()
      await open('楽天銀行')

      fireEvent.click(panel('明細マッピング').getByRole('button', { name: '共有の定義の紐づけを解除' }))

      await waitFor(() => expect(mappings.findById(target.id)!.accountIds).toEqual([card.id]))
      expect(accounts.findById(bank.id)).not.toBeNull()
    })

    it('外部明細ありで残高情報なしの科目にも、紐づけの操作が出る', async () => {
      const card = accounts.create({
        category: 'liability',
        name: 'カード未払金',
        isReconcilable: false,
        hasExternalStatement: true,
      })
      const target = definition('カード明細')
      renderTab()
      await open('カード未払金')

      fireEvent.change(panel('明細マッピング').getByLabelText('紐づける定義'), {
        target: { value: String(target.id) },
      })
      fireEvent.click(panel('明細マッピング').getByRole('button', { name: '紐づける' }))

      await waitFor(() => expect(mappings.findById(target.id)!.accountIds).toEqual([card.id]))
    })

    it('新規登録フォームで定義をチェックして登録すると、作成した科目に紐づく', async () => {
      const target = definition('入出金明細')
      accounts.create({ category: 'asset', name: '既存の口座', isReconcilable: true })
      renderTab()

      fireEvent.click(await screen.findByRole('button', { name: '資産に科目を追加' }))
      const form = within(screen.getByRole('form', { name: '科目を登録' }))
      fireEvent.change(form.getByLabelText('名称'), { target: { value: '新しい口座' } })
      fireEvent.click(form.getByLabelText('入出金明細'))
      fireEvent.click(form.getByRole('button', { name: '登録' }))

      await waitFor(() => {
        const created = accounts.findAll().find((a) => a.name === '新しい口座')
        expect(created).toBeDefined()
        expect(mappings.findById(target.id)!.accountIds).toEqual([created!.id])
      })
    })

    it('明細マッピングの文言は、紐づけが制限ではなく優先順位であることを伝える', async () => {
      accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      renderTab()

      await open('楽天銀行')

      expect(panel('明細マッピング').getByText(/紐づけていない定義も選べます/)).toBeInTheDocument()
    })
  })
})
