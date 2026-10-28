// @vitest-environment jsdom
/**
 * 科目一覧・管理画面(計画Issue #70で新設、計画Issue #95で編集・削除・非アクティブ化を追加、
 * 計画Issue #127でテーブル形式+行内インライン編集に変更、同Issueのユーザーレビューで
 * 区分列・名称・名義のみのシンプルな構成に変更しグループ割り当て・残高表示を削除)の
 * コンポーネントテスト。isSystemManaged科目を除いた登録済み全科目が、テーブル
 * (thead/tbody)の1行として区分・名称・(あれば)世帯メンバー名とともに表示されること、
 * 0件時の空状態表示、戻る操作に加え、行をクリックして入る編集モードでの名称・名義の編集
 * (保存/取消)、参照(仕訳・予算・定期取引ルール)が無い科目のみの削除、非アクティブ化/
 * アクティブ化(行内の目/目にスラッシュアイコンのみで状態を表現し、テキストタグは使わない)を、
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * グループ割り当てはAccountGroupManagementScreen側の責務になったためこの画面のテスト対象外。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsBudgetRepository } from '../../infrastructure/db/SqlJsBudgetRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { AccountListScreen } from './AccountListScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let budgetRepository: SqlJsBudgetRepository
let recurringTransactionRuleRepository: SqlJsRecurringTransactionRuleRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  budgetRepository = new SqlJsBudgetRepository(db)
  recurringTransactionRuleRepository = new SqlJsRecurringTransactionRuleRepository(db)
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountListScreen
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        budgetRepository={budgetRepository}
        recurringTransactionRuleRepository={recurringTransactionRuleRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

/** ヘッダー行を除いたtbody側の行(role="row")一覧を返す */
function getBodyRows() {
  return screen.getAllByRole('row').slice(1)
}

describe('AccountListScreen', () => {
  it('登録済み科目が区分・名称とともに一覧表示される', async () => {
    accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    renderScreen()

    const row = (await screen.findByText('普通預金')).closest('tr')!
    expect(row).toHaveTextContent('資産')
  })

  it('一覧はテーブル(thead/tbody)で表示され、区分・名称・名義の列見出しを持つ', async () => {
    accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })

    renderScreen()
    await screen.findByText('普通預金')

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '区分' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '名義' })).toBeInTheDocument()
  })

  it('isSystemManagedな科目(初期残高科目等)は一覧に表示されない', async () => {
    accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    accountRepository.create({
      category: 'equity',
      name: '初期残高(普通預金)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    renderScreen()

    await screen.findByText('普通預金')
    expect(screen.queryByText('初期残高(普通預金)')).not.toBeInTheDocument()
  })

  it('householdMemberIdが設定された科目には世帯メンバー名が併記される', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })
    accountRepository.create({
      category: 'asset',
      name: '太郎の口座',
      isReconcilable: true,
      householdMemberId: member.id,
    })
    accountRepository.create({
      category: 'asset',
      name: '共通口座',
      isReconcilable: true,
    })

    renderScreen()

    const taroRow = (await screen.findByText('太郎の口座')).closest('tr')!
    expect(taroRow).toHaveTextContent('太郎')

    const sharedRow = screen.getByText('共通口座').closest('tr')!
    expect(sharedRow).not.toHaveTextContent('太郎')
  })

  it.each([
    ['asset', '資産'],
    ['liability', '負債'],
    ['revenue', '収益'],
    ['expense', '費用'],
  ])('区分「%s」の科目には一覧に「%s」が区分列として表示される', async (category, expectedLabel) => {
    accountRepository.create({
      category: category as 'asset' | 'liability' | 'revenue' | 'expense',
      name: 'テスト科目',
      isReconcilable: category === 'asset' || category === 'liability' ? true : null,
    })

    renderScreen()

    const row = (await screen.findByText('テスト科目')).closest('tr')!
    expect(row).toHaveTextContent(expectedLabel)
  })

  it('名義(householdMemberId)が設定されている科目にはその世帯メンバー名が表示され、設定されていない科目には「全員」と表示される', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })
    accountRepository.create({
      category: 'asset',
      name: '太郎の口座',
      isReconcilable: true,
      householdMemberId: member.id,
    })
    accountRepository.create({ category: 'asset', name: '共通口座', isReconcilable: true })

    renderScreen()

    const taroRow = (await screen.findByText('太郎の口座')).closest('tr')!
    expect(within(taroRow).getByText('太郎')).toBeInTheDocument()

    const sharedRow = screen.getByText('共通口座').closest('tr')!
    expect(within(sharedRow).getByText('全員')).toBeInTheDocument()
  })

  it('登録済み科目が0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みの科目がありません')).toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('一覧の並び順はAccountRepository.findAll()の返り順(登録順)と一致する', async () => {
    accountRepository.create({ category: 'asset', name: 'B口座', isReconcilable: true })
    accountRepository.create({ category: 'asset', name: 'A口座', isReconcilable: true })

    renderScreen()

    await screen.findByText('B口座')
    const rows = getBodyRows()
    expect(rows[0]).toHaveTextContent('B口座')
    expect(rows[1]).toHaveTextContent('A口座')
  })

  describe('編集', () => {
    it('名称・名義を編集できる', async () => {
      const before = householdMemberRepository.create({ name: '太郎' })
      const after = householdMemberRepository.create({ name: '花子' })
      accountRepository.create({
        category: 'expense',
        name: '娯楽費',
        isReconcilable: null,
        householdMemberId: before.id,
      })

      renderScreen()
      await screen.findByText('娯楽費')

      fireEvent.click(screen.getByRole('button', { name: '編集' }))
      const nameInput = screen.getByLabelText('名称')
      fireEvent.change(nameInput, { target: { value: '交際費' } })
      fireEvent.change(screen.getByLabelText('名義'), { target: { value: String(after.id) } })
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))

      expect(await screen.findByText('交際費')).toBeInTheDocument()
      expect(screen.getByText('交際費').closest('tr')).toHaveTextContent('花子')
    })

    it('行をクリックして編集中でも、他の行は表示専用のままで入力欄を持たない', async () => {
      accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })
      accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

      renderScreen()
      await screen.findByText('娯楽費')

      const editingRow = screen.getByText('娯楽費').closest('tr')!
      fireEvent.click(within(editingRow).getByRole('button', { name: '編集' }))

      expect(within(editingRow).getByLabelText('名称')).toBeInTheDocument()
      const otherRow = screen.getByText('食費').closest('tr')!
      expect(within(otherRow).queryByLabelText('名称')).not.toBeInTheDocument()
      expect(within(otherRow).getByText('食費')).toBeInTheDocument()
    })

    it('取消ボタンを押すと編集前の値のまま一覧表示に戻る', async () => {
      accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })

      renderScreen()
      await screen.findByText('娯楽費')

      fireEvent.click(screen.getByRole('button', { name: '編集' }))
      fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書き換え中' } })
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

      expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
      expect(screen.getByText('娯楽費')).toBeInTheDocument()
      expect(screen.queryByText('書き換え中')).not.toBeInTheDocument()
    })

    it('同一区分内で既存の別科目と同じ名前に変更しようとすると、UNIQUE制約違反(同期例外)がエラーメッセージとして表示され、操作ボタンが再び有効になる', async () => {
      accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
      accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })

      renderScreen()
      await screen.findByText('娯楽費')

      const row = screen.getByText('娯楽費').closest('tr')!
      fireEvent.click(within(row).getByRole('button', { name: '編集' }))
      fireEvent.change(screen.getByLabelText('名称'), { target: { value: '食費' } })
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました。もう一度お試しください。')
      await waitFor(() => expect(screen.getByRole('button', { name: '保存する' })).toBeEnabled())
    })
  })

  describe('削除', () => {
    it('参照(仕訳・予算・定期取引ルール)が一切無い科目には削除ボタンが表示され、押すと一覧から消える', async () => {
      accountRepository.create({ category: 'expense', name: '未使用の費目', isReconcilable: null })

      renderScreen()
      await screen.findByText('未使用の費目')

      fireEvent.click(screen.getByRole('button', { name: '削除' }))

      await waitFor(() => expect(screen.queryByText('未使用の費目')).not.toBeInTheDocument())
    })

    it('仕訳が紐づく科目には削除ボタンが表示されない', async () => {
      const asset = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
      const equity = accountRepository.create({
        category: 'equity',
        name: '初期残高(普通預金)',
        isReconcilable: null,
        isSystemManaged: true,
      })
      journalEntryRepository.create({
        entryDate: '2026-08-11',
        sourceType: 'initial_balance',
        householdMemberId: householdMemberRepository.create({ name: '自分' }).id,
        lines: [
          { accountId: asset.id, side: 'debit', amount: 1000 },
          { accountId: equity.id, side: 'credit', amount: 1000 },
        ],
      })

      renderScreen()
      const row = (await screen.findByText('普通預金')).closest('tr')!

      expect(row.querySelector('button[data-action="delete"]')).toBeNull()
    })

    it('予算が紐づく科目には削除ボタンが表示されない', async () => {
      const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
      budgetRepository.create({ accountId: expense.id, yearMonth: '2026-08', amount: 30000 })

      renderScreen()
      const row = (await screen.findByText('食費')).closest('tr')!

      expect(row.querySelector('button[data-action="delete"]')).toBeNull()
    })

    it('定期取引ルールが紐づく科目には削除ボタンが表示されない', async () => {
      const expense = accountRepository.create({ category: 'expense', name: '家賃', isReconcilable: null })
      const liability = accountRepository.create({
        category: 'liability',
        name: '未払金',
        isReconcilable: false,
      })
      recurringTransactionRuleRepository.create({
        name: '家賃',
        debitAccountId: expense.id,
        creditAccountId: liability.id,
        amount: 80000,
        frequency: 'monthly',
        dayOfMonth: 1,
      })

      renderScreen()
      const debitRow = (await screen.findByText('家賃')).closest('tr')!
      expect(debitRow.querySelector('button[data-action="delete"]')).toBeNull()
      const creditRow = screen.getByText('未払金').closest('tr')!
      expect(creditRow.querySelector('button[data-action="delete"]')).toBeNull()
    })
  })

  describe('非アクティブ化・アクティブ化', () => {
    it('is_active = trueの科目には非アクティブ化ボタンが表示され、押すとアクティブ化ボタンに切り替わる(状態はアイコンのみで表現しタグは使わない)', async () => {
      accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })

      renderScreen()
      const row = (await screen.findByText('娯楽費')).closest('tr')!
      expect(within(row).queryByText('非アクティブ')).not.toBeInTheDocument()

      fireEvent.click(within(row).getByRole('button', { name: '非アクティブ化' }))

      await waitFor(() =>
        expect(within(row).getByRole('button', { name: 'アクティブ化' })).toBeInTheDocument(),
      )
      expect(within(row).queryByText('非アクティブ')).not.toBeInTheDocument()
      expect(row.querySelector('button[data-action="deactivate"]')).toBeNull()
    })

    it('非アクティブな科目にはアクティブ化ボタンが表示され、押すと再度非アクティブ化ボタンに切り替わる', async () => {
      const account = accountRepository.create({
        category: 'expense',
        name: '娯楽費',
        isReconcilable: null,
      })
      accountRepository.deactivate(account.id)

      renderScreen()
      const row = (await screen.findByText('娯楽費')).closest('tr')!
      expect(within(row).getByRole('button', { name: 'アクティブ化' })).toBeInTheDocument()
      expect(within(row).queryByRole('button', { name: '非アクティブ化' })).not.toBeInTheDocument()

      fireEvent.click(within(row).getByRole('button', { name: 'アクティブ化' }))

      await waitFor(() =>
        expect(within(row).getByRole('button', { name: '非アクティブ化' })).toBeInTheDocument(),
      )
      expect(row.querySelector('button[data-action="deactivate"]')).not.toBeNull()
      expect(row.querySelector('button[data-action="activate"]')).toBeNull()
    })
  })
})
