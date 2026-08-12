// @vitest-environment jsdom
/**
 * 取引先管理画面(計画Issue #38、計画Issue #85でパターン編集・削除を追加)の
 * 二重送信防止のコンポーネントテスト。作成・編集・削除・非アクティブ化・統合確定・
 * パターン編集・パターン削除の各非同期操作について、Repository呼び出しの完了を待つ間は
 * 操作ボタンが無効化され、連打による多重実行を防ぐことを検証する
 * (StatementImportUploadScreen.test.tsxと同種のテスト手法。Repositoryメソッドの解決タイミングを
 * Proxyで手動制御し、ボタンクリック直後の一時的な無効化状態を観測する)。
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

/** baseのmethodの呼び出しをgateが解決されるまで遅延させるProxyを作る(連打テスト用) */
function withDelayed<T extends object, M extends keyof T>(base: T, method: M) {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = (base[method] as unknown as (...args: unknown[]) => unknown).bind(base)
  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === method) {
        return (...args: unknown[]) => gate.then(() => original(...args))
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  return { repository: proxy as T, release }
}

function renderScreen(repository: SqlJsCounterpartyRepository) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyManagementScreen
        counterpartyRepository={repository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('CounterpartyManagementScreen 二重送信防止', () => {
  it('作成完了を待つ間は作成ボタンが無効化され、連打しても1件のみ作成される', async () => {
    const { repository, release } = withDelayed(counterpartyRepository, 'create')
    renderScreen(repository)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取引先を追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Amazon' } })
    const submitButton = screen.getByRole('button', { name: '作成する' })
    fireEvent.click(submitButton)

    expect(submitButton).toBeDisabled()
    fireEvent.click(submitButton)

    release()
    await waitFor(() => expect(screen.queryByRole('button', { name: '作成する' })).not.toBeInTheDocument())
    expect(counterpartyRepository.findAll()).toHaveLength(1)
  })

  it('編集の保存完了を待つ間は保存ボタンが無効化される', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    const { repository, release } = withDelayed(counterpartyRepository, 'update')
    renderScreen(repository)

    const item = (await screen.findByText('イオン')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'イオン 東京日本橋店' } })
    const submitButton = screen.getByRole('button', { name: '保存する' })
    fireEvent.click(submitButton)

    expect(submitButton).toBeDisabled()
    fireEvent.click(submitButton)

    release()
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存する' })).not.toBeInTheDocument())
    expect(counterpartyRepository.findAll()[0].name).toBe('イオン 東京日本橋店')
  })

  it('削除完了を待つ間は削除ボタンが無効化され、連打しても1回のみ削除される', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    const { repository, release } = withDelayed(counterpartyRepository, 'delete')
    renderScreen(repository)

    const item = (await screen.findByText('イオン')).closest('li')!
    const deleteButton = within(item).getByRole('button', { name: '削除' })
    fireEvent.click(deleteButton)

    expect(deleteButton).toBeDisabled()
    fireEvent.click(deleteButton)

    release()
    await waitFor(() => expect(screen.queryByText('イオン')).not.toBeInTheDocument())
    expect(counterpartyRepository.findAll()).toHaveLength(0)
  })

  it('非アクティブ化完了を待つ間は非アクティブ化ボタンが無効化される', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    const { repository, release } = withDelayed(counterpartyRepository, 'deactivate')
    renderScreen(repository)

    const item = (await screen.findByText('イオン')).closest('li')!
    const deactivateButton = within(item).getByRole('button', { name: '非アクティブ化' })
    fireEvent.click(deactivateButton)

    expect(deactivateButton).toBeDisabled()
    fireEvent.click(deactivateButton)

    release()
    await waitFor(() => expect(screen.getByText('イオン').closest('li')).toHaveTextContent('非アクティブ'))
  })

  it('統合確定完了を待つ間は統合確定ボタンが無効化され、連打しても1回のみ統合される', async () => {
    counterpartyRepository.create({ name: 'ローソン 東京日本橋店' })
    counterpartyRepository.create({ name: 'ローソン' })
    const { repository, release } = withDelayed(counterpartyRepository, 'merge')
    renderScreen(repository)

    const list = await screen.findByRole('list')
    const sourceItem = within(list).getByText('ローソン 東京日本橋店').closest('li')!
    fireEvent.click(within(sourceItem).getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('統合先'), {
      target: { value: String(counterpartyRepository.findAll().find((c) => c.name === 'ローソン')!.id) },
    })
    fireEvent.click(screen.getByRole('button', { name: '統合を実行' }))
    const confirmButton = screen.getByRole('button', { name: '統合を確定' })
    fireEvent.click(confirmButton)

    expect(confirmButton).toBeDisabled()
    fireEvent.click(confirmButton)

    release()
    await waitFor(() => expect(screen.getByRole('status', { name: '統合結果' })).toBeInTheDocument())

    const patterns = counterpartyRepository.findAll()
    expect(patterns.find((c) => c.name === 'ローソン 東京日本橋店')).toBeDefined()
  })

  it('パターン保存完了を待つ間は保存ボタンが無効化される', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.addPattern(counterparty.id, 'AEON')
    const { repository, release } = withDelayed(counterpartyRepository, 'updatePattern')
    renderScreen(repository)

    const item = (await screen.findByText('イオン')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '登録済みパターン: 1件' }))
    fireEvent.click(within(item).getByRole('button', { name: 'パターンを編集' }))
    fireEvent.change(within(item).getByLabelText('パターン文字列'), { target: { value: 'AEON MALL' } })
    const saveButton = within(item).getByRole('button', { name: '保存する' })
    fireEvent.click(saveButton)

    expect(saveButton).toBeDisabled()
    fireEvent.click(saveButton)

    release()
    await waitFor(() => expect(within(item).getByText('AEON MALL')).toBeInTheDocument())
    expect(counterpartyRepository.findPatternsByCounterparty(counterparty.id)).toHaveLength(1)
  })

  it('パターン削除完了を待つ間は削除ボタンが無効化され、連打しても1回のみ削除される', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.addPattern(counterparty.id, 'AEON')
    const { repository, release } = withDelayed(counterpartyRepository, 'deletePattern')
    renderScreen(repository)

    const item = (await screen.findByText('イオン')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '登録済みパターン: 1件' }))
    const deleteButton = within(item).getByRole('button', { name: 'パターンを削除' })
    fireEvent.click(deleteButton)

    expect(deleteButton).toBeDisabled()
    fireEvent.click(deleteButton)

    release()
    await waitFor(() =>
      expect(within(item).getByRole('button', { name: '登録済みパターン: 0件' })).toBeInTheDocument(),
    )
    expect(counterpartyRepository.findPatternsByCounterparty(counterparty.id)).toEqual([])
  })
})
