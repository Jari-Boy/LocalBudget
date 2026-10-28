// @vitest-environment jsdom
/**
 * 取引先管理画面(計画Issue #38、計画Issue #127でテーブル形式+行内インライン編集に変更)の
 * コンポーネントテスト。登録済み取引先の一覧表示(テーブルのthead/tbody)、新規作成(表の最終行に
 * 追加される作成用の行から行う)、既存取引先の編集(行をクリックして入る編集モードでの
 * 名称・default_account_idの変更、保存/取消)を、sql.jsのNode実装(createTestDatabase)を
 * 使った統合的なレンダリングテストとして検証する。取引先ごとに専用の<tbody>でグルーピングし、
 * 学習パターンパネルは同じ<tbody>内の追加行として展開する。削除・非アクティブ化・統合は
 * CounterpartyManagementScreen.deletion.test.tsx・CounterpartyManagementScreen.merge.test.tsx
 * に分離する。外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { CounterpartyManagementScreen } from './CounterpartyManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyManagementScreen
        counterpartyRepository={counterpartyRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('CounterpartyManagementScreen', () => {
  it('登録済み取引先が名称とともにテーブル(thead/tbody)で一覧表示される', async () => {
    counterpartyRepository.create({ name: 'イオン' })

    renderScreen()

    expect(await screen.findByText('イオン')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'デフォルト勘定科目' })).toBeInTheDocument()
  })

  it('取引先が0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みの取引先がありません')).toBeInTheDocument()
  })

  it('default_account_idが設定された取引先には勘定科目名が併記される', async () => {
    const account = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    counterpartyRepository.create({ name: 'イオン', defaultAccountId: account.id })

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('tbody')!
    expect(item).toHaveTextContent('食費')
  })

  it('名称のみを入力して新規取引先を作成できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取引先を追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Amazon' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('Amazon')).toBeInTheDocument()
    expect(counterpartyRepository.findAll()).toHaveLength(1)
  })

  it('作成用の行は取消(キャンセル)できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取引先を追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書きかけ' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.queryByText('書きかけ')).not.toBeInTheDocument()
    expect(counterpartyRepository.findAll()).toHaveLength(0)
  })

  it('default_account_idを指定して新規取引先を作成できる', async () => {
    const account = accountRepository.create({ category: 'expense', name: '日用品', isReconcilable: null })
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取引先を追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'イオン' } })
    fireEvent.change(screen.getByLabelText('デフォルト勘定科目'), { target: { value: String(account.id) } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const item = (await screen.findByText('イオン')).closest('tbody')!
    expect(item).toHaveTextContent('日用品')
  })

  it('資産・負債・純資産科目はデフォルト勘定科目の選択肢に含まれない', async () => {
    accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取引先を追加' }))

    const select = screen.getByLabelText('デフォルト勘定科目')
    expect(within(select).queryByText('普通預金')).not.toBeInTheDocument()
    expect(within(select).getByText('食費')).toBeInTheDocument()
  })

  it('既存取引先の名称を編集できる', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    renderScreen()

    const item = (await screen.findByText('イオン')).closest('tbody')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'イオン 東京日本橋店' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText('イオン 東京日本橋店')).toBeInTheDocument()
    expect(screen.queryByText('イオン')).not.toBeInTheDocument()
  })

  it('既存取引先のdefault_account_idを編集できる', async () => {
    const account = accountRepository.create({ category: 'revenue', name: '給与', isReconcilable: null })
    counterpartyRepository.create({ name: '株式会社◯◯' })
    renderScreen()

    const item = (await screen.findByText('株式会社◯◯')).closest('tbody')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('デフォルト勘定科目'), { target: { value: String(account.id) } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    const updatedItem = (await screen.findByText('株式会社◯◯')).closest('tbody')!
    expect(updatedItem).toHaveTextContent('給与')
  })

  it('編集中でも他の行は表示専用のままで入力欄を持たない', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.create({ name: 'Amazon' })
    renderScreen()
    const table = await screen.findByRole('table')

    // 取引先が2件以上の場合、統合先<select>の<option>にも同名テキストが出現するため、
    // テーブル配下に絞り込んで曖昧一致を避ける(merge.test.tsxと同じ理由)。
    const editingItem = within(table).getByText('イオン').closest('tbody')!
    fireEvent.click(within(editingItem).getByRole('button', { name: '編集' }))

    expect(within(editingItem).getByLabelText('名称')).toBeInTheDocument()
    const otherItem = within(table).getByText('Amazon').closest('tbody')!
    expect(within(otherItem).queryByLabelText('名称')).not.toBeInTheDocument()
  })

  it('編集を取消(キャンセル)すると変更前の値のまま一覧表示に戻る', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    renderScreen()

    const item = (await screen.findByText('イオン')).closest('tbody')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書き換え中' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.getByText('イオン')).toBeInTheDocument()
    expect(screen.queryByText('書き換え中')).not.toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
