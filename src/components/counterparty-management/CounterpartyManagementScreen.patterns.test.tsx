// @vitest-environment jsdom
/**
 * 取引先管理画面(計画Issue #85)の学習済みパターン一覧表示・編集・削除のコンポーネントテスト。
 * 各取引先の登録済みパターン件数表示、クリックによる一覧展開(0件時の空状態を含む)、
 * パターン文字列の編集・削除が一覧・件数表示に反映されることを、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 二重送信防止はCounterpartyManagementScreen.doubleSubmit.test.tsxで扱う。
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

function renderScreen() {
  return render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyManagementScreen
        counterpartyRepository={counterpartyRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={vi.fn()}
      />
    </I18nextProvider>,
  )
}

function findListItem(name: string) {
  return within(screen.getByRole('list')).getByText(name).closest('li')!
}

describe('CounterpartyManagementScreen 学習済みパターン', () => {
  it('パターンが0件の取引先には「登録済みパターン: 0件」と表示される', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    renderScreen()

    await screen.findByText('イオン')
    const item = findListItem('イオン')
    expect(within(item).getByRole('button', { name: '登録済みパターン: 0件' })).toBeInTheDocument()
  })

  it('登録済みパターン数が正しく表示される', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.addPattern(counterparty.id, 'AEON')
    counterpartyRepository.addPattern(counterparty.id, 'イオン')
    renderScreen()

    await screen.findByText('イオン')
    const item = findListItem('イオン')
    expect(within(item).getByRole('button', { name: '登録済みパターン: 2件' })).toBeInTheDocument()
  })

  it('件数表示をクリックすると登録済みパターンが一覧展開される', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.addPattern(counterparty.id, 'AEON')
    counterpartyRepository.addPattern(counterparty.id, 'AEON MALL')
    renderScreen()

    await screen.findByText('イオン')
    const item = findListItem('イオン')
    fireEvent.click(within(item).getByRole('button', { name: '登録済みパターン: 2件' }))

    expect(within(item).getByText('AEON')).toBeInTheDocument()
    expect(within(item).getByText('AEON MALL')).toBeInTheDocument()
  })

  it('パターンが0件の取引先を展開すると空状態の案内が表示される', async () => {
    counterpartyRepository.create({ name: 'イオン' })
    renderScreen()

    await screen.findByText('イオン')
    const item = findListItem('イオン')
    fireEvent.click(within(item).getByRole('button', { name: '登録済みパターン: 0件' }))

    expect(within(item).getByText('登録済みのパターンはありません')).toBeInTheDocument()
  })

  it('パターン文字列を編集すると一覧の表示に反映される', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    const pattern = counterpartyRepository.addPattern(counterparty.id, 'AEON')
    renderScreen()

    await screen.findByText('イオン')
    const item = findListItem('イオン')
    fireEvent.click(within(item).getByRole('button', { name: '登録済みパターン: 1件' }))
    fireEvent.click(within(item).getByRole('button', { name: 'パターンを編集' }))
    fireEvent.change(within(item).getByLabelText('パターン文字列'), {
      target: { value: 'AEON MALL' },
    })
    fireEvent.click(within(item).getByRole('button', { name: '保存する' }))

    await waitFor(() => expect(within(item).getByText('AEON MALL')).toBeInTheDocument())
    expect(within(item).queryByText('AEON')).not.toBeInTheDocument()
    expect(counterpartyRepository.findPatternsByCounterparty(counterparty.id)[0]).toMatchObject({
      id: pattern.id,
      pattern: 'AEON MALL',
    })
  })

  it('パターンを削除すると一覧・件数表示から消える', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.addPattern(counterparty.id, 'AEON')
    renderScreen()

    await screen.findByText('イオン')
    const item = findListItem('イオン')
    fireEvent.click(within(item).getByRole('button', { name: '登録済みパターン: 1件' }))
    fireEvent.click(within(item).getByRole('button', { name: 'パターンを削除' }))

    await waitFor(() =>
      expect(within(item).getByRole('button', { name: '登録済みパターン: 0件' })).toBeInTheDocument(),
    )
    expect(within(item).getByText('登録済みのパターンはありません')).toBeInTheDocument()
    expect(counterpartyRepository.findPatternsByCounterparty(counterparty.id)).toEqual([])
  })
})
