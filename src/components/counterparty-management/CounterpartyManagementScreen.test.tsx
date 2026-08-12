// @vitest-environment jsdom
/**
 * 取引先管理画面(計画Issue #38)のコンポーネントテスト。
 * 登録済み取引先の一覧表示、新規作成、既存取引先の編集(名称・default_account_id)を、
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 削除・非アクティブ化・統合はCounterpartyManagementScreen.deletion.test.tsx・
 * CounterpartyManagementScreen.merge.test.tsxに分離する。外部依存: sql.js(ネットワークアクセスなし)。
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
  it('登録済み取引先が名称とともに一覧表示される', async () => {
    counterpartyRepository.create({ name: 'イオン' })

    renderScreen()

    expect(await screen.findByText('イオン')).toBeInTheDocument()
  })

  it('取引先が0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みの取引先がありません')).toBeInTheDocument()
  })

  it('default_account_idが設定された取引先には勘定科目名が併記される', async () => {
    const account = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    counterpartyRepository.create({ name: 'イオン', defaultAccountId: account.id })

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('li')!
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

  it('default_account_idを指定して新規取引先を作成できる', async () => {
    const account = accountRepository.create({ category: 'expense', name: '日用品', isReconcilable: null })
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取引先を追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'イオン' } })
    fireEvent.change(screen.getByLabelText('デフォルト勘定科目'), { target: { value: String(account.id) } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const item = (await screen.findByText('イオン')).closest('li')!
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

    const item = (await screen.findByText('イオン')).closest('li')!
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

    const item = (await screen.findByText('株式会社◯◯')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('デフォルト勘定科目'), { target: { value: String(account.id) } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    const updatedItem = (await screen.findByText('株式会社◯◯')).closest('li')!
    expect(updatedItem).toHaveTextContent('給与')
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
