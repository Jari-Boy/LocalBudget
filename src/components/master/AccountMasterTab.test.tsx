// @vitest-environment jsdom
/**
 * AccountMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「勘定科目」タブ: 区分の見出し・グループ・科目のツリー表示、右パネルでの
 * 名称・所属グループ・名義・並び順の編集、グループの新設、科目の新規登録(右パネルのフォーム)、
 * 2回押しの削除と、使用中・中に項目があるときの削除不可の理由表示、初期残高の仕訳だけが
 * 紐づく口座の一緒に削除、システム管理科目の制限(区分変更・削除不可)、有効/無効の切り替え、
 * 資産・負債科目の右パネルの「登録時の設定」(表示のみ)と「明細マッピング」の紐づけ・解除
 * (計画Issue #189)、名称・名義が未保存のまま別の行・別の画面・新規登録へ移ろうとしたときの確認
 * (保存して移動・破棄して移動・キャンセル・保存失敗・即時反映する欄は対象外・設定オフ、計画Issue #190)を、
 * sql.jsのNode実装(createTestDatabase)を使って確認する。ドラッグ移動の判定はTreeTableの
 * テストで扱う。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveUnsavedWarningEnabled } from '../common/unsaved-changes/unsavedWarningSetting'
import { UnsavedGuardHarness } from './UnsavedGuardHarness'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountBalanceRecordRepository } from '../../infrastructure/db/SqlJsAccountBalanceRecordRepository'
import { seedBalanceAdjustmentAccount } from '../../infrastructure/db/seedBalanceAdjustmentAccount'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsBudgetRepository } from '../../infrastructure/db/SqlJsBudgetRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsKeywordRuleRepository } from '../../infrastructure/db/SqlJsKeywordRuleRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { AccountMasterTab } from './AccountMasterTab'
import { twoLineRuleLines } from '../../domain/recurring-transaction/twoLineRuleLines'

let db: Database
let accounts: SqlJsAccountRepository
let groups: SqlJsAccountGroupRepository
let entries: SqlJsJournalEntryRepository
let mappings: SqlJsImportMappingDefinitionRepository
let keywordRules: SqlJsKeywordRuleRepository
let memberId: number
let balanceRecords: SqlJsAccountBalanceRecordRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  balanceRecords = new SqlJsAccountBalanceRecordRepository(db)
  accounts = new SqlJsAccountRepository(db)
  groups = new SqlJsAccountGroupRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  mappings = new SqlJsImportMappingDefinitionRepository(db)
  keywordRules = new SqlJsKeywordRuleRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderTab(options: { initialAccountId?: number } = {}) {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <AccountMasterTab
          accountRepository={accounts}
          accountGroupRepository={groups}
          householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
          journalEntryRepository={entries}
          budgetRepository={new SqlJsBudgetRepository(db)}
          recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
          importMappingDefinitionRepository={mappings}
          keywordRuleRepository={keywordRules}
          accountBalanceRecordRepository={balanceRecords}
          initialAccountId={options.initialAccountId}
          today="2026-11-07"
        />
      </UnsavedGuardHarness>
    </I18nextProvider>,
  )
}

/** 借方・貸方の2行の仕訳を1件登録する */
function postEntry(debitId: number, creditId: number, sourceType: 'manual' | 'initial_balance' | 'auto_balance_adjustment' = 'manual') {
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
    const first = accounts.create({ category: 'expense', name: '食費', isReconcilable: null, sortOrder: 10 })
    const second = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null, sortOrder: 11 })
    renderTab()
    await open('食費')

    fireEvent.click(panel('科目の編集').getByRole('button', { name: '下へ' }))

    await waitFor(() => expect(accounts.findById(first.id)!.sortOrder).toBeGreaterThan(accounts.findById(second.id)!.sortOrder))
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

  it('自動で作られた仕訳だけが紐づく口座は、確認の文言でその旨が伝わり、仕訳と一緒に削除される', async () => {
    const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
    const initial = accounts.findAll().find((a) => a.isSystemManaged)!
    const entry = postEntry(bank.id, initial.id, 'auto_balance_adjustment')
    renderTab()
    await open('楽天銀行')

    fireEvent.click(panel('科目の編集').getByRole('button', { name: '削除' }))
    expect(panel('科目の編集').getByText('自動で作られた仕訳(初期残高・自動調整)と残高の記録も一緒に削除します。')).toBeInTheDocument()
    fireEvent.click(panel('科目の編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(accounts.findById(bank.id)).toBeNull())
    expect(entries.findAll().some((e) => e.id === entry.id)).toBe(false)
  })

  it('初期残高の仕訳のほかに通常の仕訳がある口座は、削除できない', async () => {
    const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: false })
    const initial = accounts.findAll().find((a) => a.isSystemManaged)!
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    postEntry(bank.id, initial.id, 'auto_balance_adjustment')
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

    /** 「紐づける定義」の選択ツリーを開き、定義を選ぶ(選んだ時点で紐づく。マッピングタブの「対応する科目」と同じ操作) */
    const linkDefinition = (label: string) => {
      fireEvent.click(panel('明細マッピング').getByRole('button', { name: /^紐づける定義/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '紐づける定義' })).getByRole('button', { name: label }))
    }

    /** 「外部明細の情報」の1項目(見出しと値のまとまり) */
    const item = (info: ReturnType<typeof panel>, label: string) => within(info.getByText(label).closest('div')!)

    it('外部明細ありで残高情報ありの資産科目は、外部明細・残高情報が表示される(初期残高は照合欄へ統合、計画Issue #205)', async () => {
      accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      renderTab()

      await open('楽天銀行')

      const info = panel('外部明細の情報')
      expect(item(info, '外部明細').getByText('あり')).toBeInTheDocument()
      expect(item(info, '残高情報').getByText('あり')).toBeInTheDocument()
      expect(info.queryByText('初期残高')).toBeNull()
    })

    it('外部明細あり・残高情報なし(カード未払金)は、外部明細あり・残高情報なしと区別して表示される', async () => {
      accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false, hasExternalStatement: true })
      renderTab()

      await open('カード未払金')

      const info = panel('外部明細の情報')
      expect(item(info, '外部明細').getByText('あり')).toBeInTheDocument()
      expect(item(info, '残高情報').getByText('なし')).toBeInTheDocument()
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

      linkDefinition(target.label)

      await waitFor(() => expect(mappings.findById(target.id)!.accountIds).toEqual([bank.id]))
      expect(await panel('明細マッピング').findByRole('list')).toHaveTextContent('入出金明細')
    })

    it('紐づけると、他の科目との紐づけは影響を受けない', async () => {
      const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
      const card = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false })
      const target = definition('共有の定義', [card.id])
      renderTab()
      await open('楽天銀行')

      linkDefinition(target.label)

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

      linkDefinition(target.label)

      await waitFor(() => expect(mappings.findById(target.id)!.accountIds).toEqual([card.id]))
    })

    it('新規登録フォームで定義を選んで登録すると、作成した科目に紐づく', async () => {
      const target = definition('入出金明細')
      accounts.create({ category: 'asset', name: '既存の口座', isReconcilable: true })
      renderTab()

      fireEvent.click(await screen.findByRole('button', { name: '資産に科目を追加' }))
      const form = within(screen.getByRole('form', { name: '科目を登録' }))
      fireEvent.change(form.getByLabelText('名称'), { target: { value: '新しい口座' } })
      fireEvent.click(form.getByRole('button', { name: /^紐づける定義/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '紐づける定義' })).getByRole('button', { name: '入出金明細' }))
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
  describe('科目の統合(計画Issue #97)', () => {
    const check = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `${name}を選択` }))
    const mergePanel = () => within(screen.getByRole('region', { name: '科目の統合' }))

    it('2件以上チェックすると統合の欄が出て、確認を経て仕訳が統合先に付け替えられる', async () => {
      const target = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
      const bus = accounts.create({ category: 'expense', name: 'バス代', isReconcilable: null })
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      const entry = postEntry(bus.id, cash.id)
      renderTab()
      await screen.findByRole('button', { name: '交通費' })
      expect(screen.queryByRole('region', { name: '科目の統合' })).not.toBeInTheDocument()

      check('交通費')
      check('バス代')
      fireEvent.change(mergePanel().getByLabelText('統合先'), { target: { value: String(target.id) } })
      fireEvent.click(mergePanel().getByRole('button', { name: '統合する' }))
      expect(mergePanel().getByText(/仕訳の明細1行を付け替えます/)).toBeInTheDocument()
      expect(entries.findById(entry.id)!.lines.some((l) => l.accountId === bus.id)).toBe(true)
      fireEvent.click(mergePanel().getByRole('button', { name: '統合を実行' }))

      await waitFor(() =>
        expect(entries.findById(entry.id)!.lines.map((l) => l.accountId)).not.toContain(bus.id),
      )
      expect(entries.findById(entry.id)!.lines.map((l) => l.accountId)).toContain(target.id)
      expect(await screen.findByText(/「バス代」を「交通費」に統合しました/)).toBeInTheDocument()
    })

    it('2件以上チェックすると、右パネルが編集パネルから一括操作パネルに切り替わり、1件に戻すと編集パネルに戻る', async () => {
      accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
      accounts.create({ category: 'expense', name: 'バス代', isReconcilable: null })
      renderTab()
      await open('交通費')
      expect(screen.getByRole('region', { name: '科目の編集' })).toBeInTheDocument()

      check('交通費')
      check('バス代')

      expect(screen.getByRole('region', { name: '一括操作' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '科目の編集' })).not.toBeInTheDocument()
      expect(screen.getByText('2件を選択中')).toBeInTheDocument()

      check('バス代')

      expect(screen.queryByRole('region', { name: '一括操作' })).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: '科目の編集' })).toBeInTheDocument()
    })

    it('一括操作パネルの「グループへ移動」で、チェックした科目がまとめてグループに入る', async () => {
      const group = groups.create({ name: '交通', category: 'expense' })
      const bus = accounts.create({ category: 'expense', name: 'バス代', isReconcilable: null })
      const train = accounts.create({ category: 'expense', name: '電車賃', isReconcilable: null })
      renderTab()
      await screen.findByRole('button', { name: 'バス代' })
      check('バス代')
      check('電車賃')

      fireEvent.change(screen.getByLabelText('移動先'), { target: { value: `g:${group.id}` } })

      await waitFor(() => expect(accounts.findById(bus.id)!.accountGroupId).toBe(group.id))
      expect(accounts.findById(train.id)!.accountGroupId).toBe(group.id)
    })

    it('区分が異なる科目をチェックすると、統合できない理由が表示され、統合ボタンは出ない', async () => {
      accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
      accounts.create({ category: 'revenue', name: '雑収入', isReconcilable: null })
      renderTab()
      await screen.findByRole('button', { name: '交通費' })

      check('交通費')
      check('雑収入')

      expect(mergePanel().getByText(/区分が異なる科目は統合できません/)).toBeInTheDocument()
      expect(mergePanel().queryByRole('button', { name: '統合する' })).not.toBeInTheDocument()
    })

    it('統合先の選択肢には有効な科目だけが並ぶ', async () => {
      const off = accounts.create({ category: 'expense', name: '旧交通費', isReconcilable: null })
      accounts.create({ category: 'expense', name: 'バス代', isReconcilable: null })
      accounts.deactivate(off.id)
      renderTab()
      await screen.findByRole('button', { name: 'バス代' })

      check('旧交通費')
      check('バス代')

      const options = within(mergePanel().getByLabelText('統合先')).getAllByRole('option').map((o) => o.textContent)
      expect(options).toEqual(['選択してください', 'バス代'])
    })

    it('統合後、仕訳が0件になった統合元は、削除できるようになる', async () => {
      const target = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
      const bus = accounts.create({ category: 'expense', name: 'バス代', isReconcilable: null })
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      postEntry(bus.id, cash.id)
      renderTab()
      await screen.findByRole('button', { name: '交通費' })
      check('交通費')
      check('バス代')
      fireEvent.change(mergePanel().getByLabelText('統合先'), { target: { value: String(target.id) } })
      fireEvent.click(mergePanel().getByRole('button', { name: '統合する' }))
      fireEvent.click(await mergePanel().findByRole('button', { name: '統合を実行' }))
      await screen.findByText(/統合しました/)

      await open('バス代')

      expect(panel('科目の編集').getByRole('button', { name: '削除' })).toBeEnabled()
    })
  })
})

describe('AccountMasterTab 未保存の編集の警告(計画Issue #190)', () => {
  const dialog = () => screen.queryByRole('dialog', { name: '未保存の変更があります' })
  const nameInput = () => panel('科目の編集').getByLabelText('名称')

  /** 食費・交通費を作り、食費を開いて名称を書き換えた(未保存の)状態にする */
  async function editFood() {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    renderTab()
    await open('食費')
    fireEvent.change(nameInput(), { target: { value: '食料費' } })
  }

  it('書き換えていないときは、別の行を選んでも確認は出ない', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    renderTab()
    await open('食費')
    await open('交通費')
    expect(dialog()).not.toBeInTheDocument()
    expect(nameInput()).toHaveValue('交通費')
  })

  it('未保存のまま別の行を選ぶと確認が出て、キャンセルでは行を移らず入力が残る', async () => {
    await editFood()
    await open('交通費')
    expect(dialog()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(dialog()).not.toBeInTheDocument()
    expect(nameInput()).toHaveValue('食料費')
  })

  it('「破棄して移動」で保存せずに移る', async () => {
    await editFood()
    await open('交通費')
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
    expect(nameInput()).toHaveValue('交通費')
    expect(accounts.findAll().map((a) => a.name)).toContain('食費')
  })

  it('「保存して移動」で名称を保存してから移る', async () => {
    await editFood()
    await open('交通費')
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    await waitFor(() => expect(nameInput()).toHaveValue('交通費'))
    expect(accounts.findAll().map((a) => a.name)).toContain('食料費')
  })

  it('保存に失敗(同じ区分で名称が重複)したときは移動せず、エラーが出て入力が残る', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    renderTab()
    await open('食費')
    fireEvent.change(nameInput(), { target: { value: '交通費' } })
    await open('交通費')
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました')
    expect(dialog()).not.toBeInTheDocument()
    expect(nameInput()).toHaveValue('交通費')
  })

  it('名義だけを変えて未保存のときも、別の行を選ぶと確認が出る', async () => {
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    await open('楽天銀行')
    fireEvent.change(panel('科目の編集').getByLabelText('名義'), { target: { value: String(memberId) } })
    await open('食費')
    expect(dialog()).toBeInTheDocument()
  })

  it('所属グループの変更は選んだ時点で反映されるため、確認の対象にならない', async () => {
    const group = groups.create({ name: '日常', category: 'expense' })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    renderTab()
    await open('食費')
    fireEvent.change(panel('科目の編集').getByLabelText('所属グループ'), { target: { value: `g:${group.id}` } })
    await waitFor(() => expect(panel('科目の編集').getByLabelText('所属グループ')).toHaveDisplayValue('日常'))
    await open('交通費')
    expect(dialog()).not.toBeInTheDocument()
  })

  it('未保存のままサイドナビのリンクを押すと確認が出て、「破棄して移動」で移動する', async () => {
    await editFood()
    fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/master/here')
    expect(dialog()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/other')
  })

  it('新規登録フォームに名称を入力したまま別の行を選ぶと確認が出て、「保存して移動」で登録してから移る', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '費用に科目を追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '光熱費' } })
    await open('食費')
    expect(dialog()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    await waitFor(() => expect(nameInput()).toHaveValue('食費'))
    expect(accounts.findAll().map((a) => a.name)).toContain('光熱費')
  })

  it('新規登録フォームを開いただけ(何も入力していない)ときは、別の行を選んでも確認は出ない', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '費用に科目を追加' }))
    await open('食費')
    expect(dialog()).not.toBeInTheDocument()
  })

  it('設定が「出さない」のときは、未保存でも確認なしで別の行へ移る', async () => {
    saveUnsavedWarningEnabled(false)
    await editFood()
    await open('交通費')
    expect(dialog()).not.toBeInTheDocument()
    expect(nameInput()).toHaveValue('交通費')
  })
})

describe('AccountMasterTab: 残高の照合欄(計画Issue #205)', () => {
  const section = () => panel('残高の照合')
  /** 照合表の読み込みが終わり、欄が表示されるのを待つ */
  const ready = () => screen.findByRole('region', { name: '残高の照合' })

  /** 現金から食費への支出(帳簿の増減)を1件入れる */
  function spendFromCash(cashId: number, date: string, amount: number) {
    const food = accounts.findAll().find((a) => a.name === '食費') ?? accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    entries.create({
      entryDate: date,
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: food.id, side: 'debit', amount },
        { householdMemberId: memberId, accountId: cashId, side: 'credit', amount },
      ],
    })
  }

  function record(date: string, amount: string) {
    fireEvent.change(section().getByLabelText('日付'), { target: { value: date } })
    fireEvent.change(section().getByLabelText('金額'), { target: { value: amount } })
    fireEvent.click(section().getByRole('button', { name: '残高を記録する' }))
  }

  it('資産・負債の科目にだけ出て、収益・費用の科目には出ない', async () => {
    accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()

    await open('現金')
    expect(await ready()).toBeInTheDocument()
    await open('食費')
    expect(screen.queryByRole('region', { name: '残高の照合' })).toBeNull()
  })

  it('initialAccountIdを渡すと、その科目を最初から選んだ状態で開く(仕訳の詳細の「科目の照合を見る」から来る)', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    renderTab({ initialAccountId: cash.id })

    expect(await ready()).toBeInTheDocument()
    expect(panel('科目の編集').getByLabelText('名称')).toHaveValue('現金')
  })

  it('システム管理の科目(立替金・未払金など)には、残高の照合欄を出さない', async () => {
    accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, hasExternalStatement: false, isSystemManaged: true })
    renderTab()

    await open('立替金')

    expect(await screen.findByRole('region', { name: '科目の編集' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '残高の照合' })).toBeNull()
  })

  it('自動調整の説明は、角丸のツールチップ(CSSで出し入れ)にし、「原因を直すと」の手前で改行する', async () => {
    accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    renderTab()
    await open('現金')
    await ready()

    // 標準のtitle属性だと枠の形を変えられないので使わない
    expect(section().queryAllByTitle(/ずれた区間ごとに調整の仕訳が自動で入ります/)).toHaveLength(0)
    const tooltip = section().getByRole('tooltip', { hidden: true })
    expect(tooltip.textContent).toMatch(/ずれた区間ごとに調整の仕訳が自動で入ります。\n原因を直すと調整は消えるか金額が変わります/)
    expect(section().getByRole('checkbox', { name: '基準点に合わせて自動で調整する' })).toHaveAccessibleDescription(/ずれた区間ごとに/)
  })

  it('自動調整のチェックボックスは初期値がオンで、外すと科目の設定に保存される', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    renderTab()
    await open('現金')
    await ready()

    const checkbox = section().getByRole('checkbox', { name: '基準点に合わせて自動で調整する' })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    await waitFor(() => expect(accounts.findById(cash.id)!.autoBalanceAdjustment).toBe(false))
    expect(section().getByRole('checkbox', { name: '基準点に合わせて自動で調整する' })).not.toBeChecked()
  })

  it('手で記録する科目は、日付と金額を入れて残高を記録でき、表に元手(初期残高)の行が出る', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    renderTab()
    await open('現金')
    await ready()

    record('2026-01-31', '10000')

    await waitFor(() => expect(balanceRecords.findByAccount(cash.id)).toHaveLength(1))
    const row = await section().findByRole('row', { name: /2026-01-31/ })
    expect(within(row).getByText('初期残高')).toBeInTheDocument()
    expect(within(row).getByText('¥10,000')).toBeInTheDocument()
    expect(entries.findAll().filter((e) => e.sourceType === 'auto_balance_adjustment')).toHaveLength(1)
  })

  it('金額を入れると、その日の帳簿残高との差と、記録すると入る調整額をその場で表示する', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    balanceRecords.create({ accountId: cash.id, recordDate: '2026-01-31', balance: 10000 })
    spendFromCash(cash.id, '2026-02-10', 2000)
    renderTab()
    await open('現金')
    await ready()

    fireEvent.change(section().getByLabelText('日付'), { target: { value: '2026-02-28' } })
    fireEvent.change(section().getByLabelText('金額'), { target: { value: '7000' } })

    expect(await section().findByText(/この日の帳簿残高 ¥8,000/)).toBeInTheDocument()
    expect(section().getByText(/記録すると −¥1,000 の調整が入ります/)).toBeInTheDocument()
  })

  it('2つ目以降の記録の食い違いは自動調整として表に載り、下に合計(初期残高を除く)が出る', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    balanceRecords.create({ accountId: cash.id, recordDate: '2026-01-31', balance: 10000 })
    spendFromCash(cash.id, '2026-02-10', 2000)
    renderTab()
    await open('現金')
    await ready()

    record('2026-02-28', '7000')

    const row = await section().findByRole('row', { name: /2026-02-28/ })
    expect(within(row).getByText('2026-02-01〜2026-02-28')).toBeInTheDocument()
    expect(within(row).getByText('−¥1,000')).toBeInTheDocument()
    const total = section().getByRole('row', { name: /自動調整の合計\(初期残高を除く\)/ })
    expect(within(total).getByText('−¥1,000')).toBeInTheDocument()
  })

  it('記録は行ごとに編集・削除でき、反映すると調整も計算し直される', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    const first = balanceRecords.create({ accountId: cash.id, recordDate: '2026-01-31', balance: 10000 })
    renderTab()
    await open('現金')
    await ready()

    fireEvent.click(await section().findByRole('button', { name: '2026-01-31の記録を編集' }))
    fireEvent.change(section().getByLabelText('記録した残高'), { target: { value: '12000' } })
    fireEvent.click(section().getByRole('button', { name: '更新' }))
    await waitFor(() => expect(balanceRecords.findByAccount(cash.id)[0].balance).toBe(12000))

    fireEvent.click(await section().findByRole('button', { name: '2026-01-31の記録を削除' }))
    await waitFor(() => expect(balanceRecords.findByAccount(cash.id)).toHaveLength(0))
    expect(first.id).toBeGreaterThan(0)
    expect(entries.findAll().filter((e) => e.sourceType === 'auto_balance_adjustment')).toHaveLength(0)
  })

  it('取引後残高のあるCSVの科目は、記録欄も編集・削除も出さず、表だけを出す', async () => {
    const bank = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })
    const salary = accounts.create({ category: 'revenue', name: '給与', isReconcilable: null })
    entries.create({
      entryDate: '2026-02-10',
      sourceType: 'external_import',
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: bank.id, side: 'debit', amount: 1000 },
        { householdMemberId: memberId, accountId: salary.id, side: 'credit', amount: 1000 },
      ],
      externalTransactionRef: {
        accountId: bank.id,
        externalId: 'A',
        entryDate: '2026-02-10',
        description: '給与',
        amount: 1000,
        externalBalanceAfter: 11000,
        rowOrder: 0,
      },
    })
    renderTab()
    await open('楽天銀行')
    await ready()

    expect(await section().findByRole('row', { name: /2026-02-10/ })).toBeInTheDocument()
    expect(section().queryByRole('button', { name: '残高を記録する' })).toBeNull()
    expect(section().queryByRole('button', { name: /の記録を編集/ })).toBeNull()
    expect(section().getByText('明細の残高')).toBeInTheDocument()
  })

  it('自動調整をオフにすると、調整は入らず、ずれている額が表に出る', async () => {
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
    balanceRecords.create({ accountId: cash.id, recordDate: '2026-01-31', balance: 10000 })
    balanceRecords.create({ accountId: cash.id, recordDate: '2026-02-28', balance: 7000 })
    accounts.update(cash.id, { autoBalanceAdjustment: false })
    renderTab()
    await open('現金')
    await ready()

    const row = await section().findByRole('row', { name: /2026-02-28/ })
    expect(within(row).getByText('ずれ −¥3,000')).toBeInTheDocument()
  })

  describe('キーワード(資産・負債の科目だけ、計画Issue #219)', () => {
    it('資産の科目の右パネルに、その科目を相手科目に指定したキーワードが一覧される', async () => {
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      keywordRules.create({ pattern: 'ATM', accountId: cash.id })
      renderTab()

      await open('現金')

      expect(await panel('科目の編集').findByRole('heading', { name: 'キーワード(1件)' })).toBeInTheDocument()
      expect(panel('科目の編集').getByText('ATM')).toBeInTheDocument()
    })

    it('収益・費用の科目の右パネルには、キーワードの欄が出ない', async () => {
      const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
      keywordRules.create({ pattern: 'ATM', accountId: food.id })
      renderTab()

      await open('食費')

      expect(screen.queryByRole('heading', { name: /^キーワード/ })).not.toBeInTheDocument()
    })

    it('キーワードの入力欄は、「キーワードを追加」を押すまで出ない。キャンセルで閉じる(計画Issue #219)', async () => {
      accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      renderTab()
      await open('現金')
      const add = await panel('科目の編集').findByRole('button', { name: 'キーワードを追加' })
      expect(panel('科目の編集').queryByLabelText('追加するキーワード')).not.toBeInTheDocument()

      fireEvent.click(add)

      expect(panel('科目の編集').getByLabelText('追加するキーワード')).toBeInTheDocument()
      fireEvent.click(panel('科目の編集').getByRole('button', { name: 'キャンセル' }))
      expect(panel('科目の編集').queryByLabelText('追加するキーワード')).not.toBeInTheDocument()
    })

    it('キーワードを追加すると、正規化して科目のルールとして保存される', async () => {
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      renderTab()
      await open('現金')

      fireEvent.click(await panel('科目の編集').findByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(panel('科目の編集').getByLabelText('追加するキーワード'), { target: { value: 'ａｔｍ' } })
      fireEvent.click(panel('科目の編集').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(keywordRules.findByAccount(cash.id).map((r) => r.pattern)).toEqual(['ATM']))
    })

    it('正規化後に同じキーワードは、共通の検証で拒否され理由が表示される', async () => {
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      keywordRules.create({ pattern: 'ATM', accountId: cash.id })
      renderTab()
      await open('現金')

      fireEvent.click(await panel('科目の編集').findByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(panel('科目の編集').getByLabelText('追加するキーワード'), { target: { value: 'atm' } })
      fireEvent.click(panel('科目の編集').getByRole('button', { name: '追加' }))

      expect(await screen.findByText('同じ取引先・科目に、同じキーワードがすでにあります')).toBeInTheDocument()
      expect(keywordRules.findByAccount(cash.id)).toHaveLength(1)
    })

    it('キーワードを編集して保存でき、削除もできる', async () => {
      const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
      const rule = keywordRules.create({ pattern: 'ATM', accountId: cash.id })
      renderTab()
      await open('現金')

      fireEvent.click(await panel('科目の編集').findByRole('button', { name: 'ATMを編集' }))
      fireEvent.change(panel('科目の編集').getByLabelText('キーワード'), { target: { value: 'セブン銀行' } })
      fireEvent.click(panel('科目の編集').getByRole('button', { name: 'キーワードを保存' }))
      await waitFor(() => expect(keywordRules.findById(rule.id)?.pattern).toBe('セブン銀行'))

      fireEvent.click(await panel('科目の編集').findByRole('button', { name: 'セブン銀行を削除' }))
      await waitFor(() => expect(keywordRules.findByAccount(cash.id)).toHaveLength(0))
    })
  })

  it('検索欄に入れた文字列で、名称に一致する科目と、その科目を持つグループだけに絞り込める(計画Issue #219)', async () => {
    const group = groups.create({ name: '普通預金', category: 'asset' })
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true, accountGroupId: group.id })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderTab()
    await screen.findByRole('button', { name: '食費' })

    fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: '楽天' } })

    expect(screen.queryByRole('button', { name: '食費' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '楽天銀行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '普通預金' })).toBeInTheDocument()
  })
})

