// @vitest-environment jsdom
/**
 * 取引先管理画面(計画Issue #38)の削除・非アクティブ化のコンポーネントテスト。
 * docs/domain/counterparties.md 1.5節の通り、紐づく仕訳明細が0件の取引先は物理削除、
 * 1件以上ある取引先は非アクティブ化のみ可能であることを、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
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
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { CounterpartyManagementScreen } from './CounterpartyManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
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

describe('CounterpartyManagementScreen 削除・非アクティブ化', () => {
  it('紐づく仕訳明細が0件の取引先は削除ボタンで一覧から消える', async () => {
    counterpartyRepository.create({ name: 'イオン' })

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '削除' }))

    await waitFor(() => expect(screen.queryByText('イオン')).not.toBeInTheDocument())
    expect(counterpartyRepository.findAll()).toHaveLength(0)
  })

  it('紐づく仕訳明細が1件以上ある取引先には削除ボタンが表示されない', async () => {
    const expenseAccount = accountRepository.create({
      category: 'expense',
      name: '食費',
      isReconcilable: null,
    })
    const cashAccount = accountRepository.create({
      category: 'asset',
      name: '現金',
      isReconcilable: false,
    })
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-08-11',
      lines: [
        { accountId: expenseAccount.id, side: 'debit', amount: 1000, counterpartyId: counterparty.id },
        { accountId: cashAccount.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('li')!
    expect(within(item).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('紐づく仕訳明細が0件の取引先にも非アクティブ化ボタンが表示され、押すと一覧上で非アクティブと判別できる', async () => {
    counterpartyRepository.create({ name: 'イオン' })

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '非アクティブ化' }))

    const updatedItem = (await screen.findByText('イオン')).closest('li')!
    expect(updatedItem).toHaveTextContent('非アクティブ')
  })

  it('紐づく仕訳明細が1件以上ある取引先の非アクティブ化ボタンを押すと非アクティブと判別できる', async () => {
    const expenseAccount = accountRepository.create({
      category: 'expense',
      name: '食費',
      isReconcilable: null,
    })
    const cashAccount = accountRepository.create({
      category: 'asset',
      name: '現金',
      isReconcilable: false,
    })
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-08-11',
      lines: [
        { accountId: expenseAccount.id, side: 'debit', amount: 1000, counterpartyId: counterparty.id },
        { accountId: cashAccount.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '非アクティブ化' }))

    const updatedItem = (await screen.findByText('イオン')).closest('li')!
    expect(updatedItem).toHaveTextContent('非アクティブ')
  })

  it('既に非アクティブ化された取引先には非アクティブ化ボタンが表示されない', async () => {
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    counterpartyRepository.deactivate(counterparty.id)

    renderScreen()

    const item = (await screen.findByText('イオン')).closest('li')!
    expect(within(item).queryByRole('button', { name: '非アクティブ化' })).not.toBeInTheDocument()
  })
})
