// @vitest-environment jsdom
/**
 * 確定済み仕訳一覧画面(計画Issue #40)のコンポーネントテスト。journal_entriesを
 * 日付・摘要・取引金額のタスク指向の表現(借方/貸方等の簿記用語を見せない形)で
 * 一覧表示し、選択した仕訳の詳細画面への遷移を、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 下書き一覧(JournalEntryDraftListScreen)とは別物で、確定済み仕訳のみを対象とする。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { JournalEntryListScreen } from './JournalEntryListScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen(overrides?: { onSelectEntry?: (entry: JournalEntry) => void; onBack?: () => void }) {
  const onSelectEntry = overrides?.onSelectEntry ?? vi.fn()
  const onBack = overrides?.onBack ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryListScreen
        journalEntryRepository={journalEntryRepository}
        onSelectEntry={onSelectEntry}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
  return { onSelectEntry, onBack }
}

describe('JournalEntryListScreen', () => {
  it('確定済み仕訳が0件の場合、空状態メッセージが表示される', async () => {
    renderScreen()

    expect(await screen.findByText('確定済みの仕訳はまだありません')).toBeInTheDocument()
  })

  it('確定済み仕訳が日付・摘要・取引金額とともに一覧表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('スーパーで食材購入')).closest('li')!
    expect(item).toHaveTextContent('2026-08-01')
    expect(item).toHaveTextContent('￥3,000')
  })

  it('摘要が未入力の仕訳は代替テキストで表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen()

    expect(await screen.findByText('摘要なし')).toBeInTheDocument()
  })

  it('仕訳を選択すると、対応する仕訳を引数にonSelectEntryが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const created = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    const { onSelectEntry } = renderScreen()
    await screen.findByText('スーパーで食材購入')

    fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }))

    expect(onSelectEntry).toHaveBeenCalledTimes(1)
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }))
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const { onBack } = renderScreen()
    await screen.findByText('確定済みの仕訳はまだありません')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
