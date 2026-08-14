// @vitest-environment jsdom
/**
 * 科目一覧・管理画面(計画Issue #70で新設、計画Issue #95で編集・削除・非アクティブ化を追加)の
 * コンポーネントテスト。isSystemManaged科目を除いた登録済み全科目が、区分を問わずフラットな
 * 一覧として名称・残高・(あれば)世帯メンバー名とともに表示されること、0件時の空状態表示、
 * 戻る操作に加え、名称・名義の編集、参照(仕訳・予算・定期取引ルール)が無い科目のみの削除、
 * 非アクティブ化を、sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテスト
 * として検証する。外部依存: sql.js(ネットワークアクセスなし)。
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

describe('AccountListScreen', () => {
  it('登録済み科目が名称と残高とともに一覧表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
      householdMemberId: null,
    })
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
        { accountId: account.id, side: 'debit', amount: 50000 },
        { accountId: equity.id, side: 'credit', amount: 50000 },
      ],
    })

    renderScreen()

    expect(await screen.findByText('普通預金')).toBeInTheDocument()
    expect(screen.getByText('￥50,000')).toBeInTheDocument()
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

    const taroItem = (await screen.findByText('太郎の口座')).closest('li')!
    expect(taroItem).toHaveTextContent('太郎')

    const sharedItem = screen.getByText('共通口座').closest('li')!
    expect(sharedItem).not.toHaveTextContent('太郎')
  })

  it.each([
    ['asset', '資産'],
    ['liability', '負債'],
    ['revenue', '収益'],
    ['expense', '費用'],
  ])('区分「%s」の科目には一覧に「%s」の区分表示が併記される', async (category, expectedLabel) => {
    accountRepository.create({
      category: category as 'asset' | 'liability' | 'revenue' | 'expense',
      name: 'テスト科目',
      isReconcilable: category === 'asset' || category === 'liability' ? true : null,
    })

    renderScreen()

    const item = (await screen.findByText('テスト科目')).closest('li')!
    expect(item).toHaveTextContent(expectedLabel)
  })

  it('名義(householdMemberId)が設定されている科目には「名義: 太郎」のように表示され、設定されていない科目には「名義: 全員」と表示される', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })
    accountRepository.create({
      category: 'asset',
      name: '太郎の口座',
      isReconcilable: true,
      householdMemberId: member.id,
    })
    accountRepository.create({ category: 'asset', name: '共通口座', isReconcilable: true })

    renderScreen()

    const taroItem = (await screen.findByText('太郎の口座')).closest('li')!
    expect(taroItem).toHaveTextContent('名義: 太郎')

    const sharedItem = screen.getByText('共通口座').closest('li')!
    expect(sharedItem).toHaveTextContent('名義: 全員')
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
    const names = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(names[0]).toContain('B口座')
    expect(names[1]).toContain('A口座')
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
      expect(screen.getByText('交際費').closest('li')).toHaveTextContent('花子')
    })

    it('同一区分内で既存の別科目と同じ名前に変更しようとすると、UNIQUE制約違反(同期例外)がエラーメッセージとして表示され、操作ボタンが再び有効になる', async () => {
      accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
      accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })

      renderScreen()
      await screen.findByText('娯楽費')

      const item = screen.getByText('娯楽費').closest('li')!
      fireEvent.click(within(item).getByRole('button', { name: '編集' }))
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
      const item = (await screen.findByText('普通預金')).closest('li')!

      expect(item.querySelector('button[data-action="delete"]')).toBeNull()
    })

    it('予算が紐づく科目には削除ボタンが表示されない', async () => {
      const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
      budgetRepository.create({ accountId: expense.id, yearMonth: '2026-08', amount: 30000 })

      renderScreen()
      const item = (await screen.findByText('食費')).closest('li')!

      expect(item.querySelector('button[data-action="delete"]')).toBeNull()
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
      const debitItem = (await screen.findByText('家賃')).closest('li')!
      expect(debitItem.querySelector('button[data-action="delete"]')).toBeNull()
      const creditItem = screen.getByText('未払金').closest('li')!
      expect(creditItem.querySelector('button[data-action="delete"]')).toBeNull()
    })
  })

  describe('非アクティブ化', () => {
    it('is_active = trueの科目には非アクティブ化ボタンが表示され、押すと非アクティブになる', async () => {
      accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })

      renderScreen()
      await screen.findByText('娯楽費')

      fireEvent.click(screen.getByRole('button', { name: '非アクティブ化' }))

      const item = await waitFor(() => {
        const el = screen.getByText('娯楽費').closest('li')!
        expect(el).toHaveTextContent('非アクティブ')
        return el
      })
      expect(item.querySelector('button[data-action="deactivate"]')).toBeNull()
    })
  })
})
