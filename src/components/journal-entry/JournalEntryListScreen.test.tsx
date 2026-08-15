// @vitest-environment jsdom
/**
 * 確定済み仕訳一覧画面(計画Issue #40)のコンポーネントテスト。journal_entriesを
 * 日付・摘要・取引金額のタスク指向の表現(借方/貸方等の簿記用語を見せない形)で
 * 一覧表示し、選択した仕訳の詳細画面への遷移を、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * また、findUnallocatedEntries(docs/domain/expense-splitting.md 1.5節)による
 * 割勘対象候補の絞り込み(既に割勘済みの仕訳には「割勘する」ボタンを出さない)も検証する。
 * 下書き一覧(JournalEntryDraftListScreen)とは別物で、確定済み仕訳のみを対象とする。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { JournalEntryListScreen } from './JournalEntryListScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let projectRepository: SqlJsProjectRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
})

afterEach(cleanup)

function renderScreen(overrides?: {
  onSelectEntry?: (entry: JournalEntry) => void
  onStartSplitting?: (entry: JournalEntry) => void
  onBack?: () => void
}) {
  const onSelectEntry = overrides?.onSelectEntry ?? vi.fn()
  const onStartSplitting = overrides?.onStartSplitting ?? vi.fn()
  const onBack = overrides?.onBack ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryListScreen
        journalEntryRepository={journalEntryRepository}
        onSelectEntry={onSelectEntry}
        onStartSplitting={onStartSplitting}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
  return { onSelectEntry, onStartSplitting, onBack }
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

  it('まだ割勘されていない仕訳には「割勘する」ボタンが表示され、押すと対応する仕訳を引数にonStartSplittingが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    const { onStartSplitting } = renderScreen()
    await screen.findByText('スーパーで食材購入')

    fireEvent.click(screen.getByRole('button', { name: '割勘する' }))

    expect(onStartSplitting).toHaveBeenCalledTimes(1)
    expect(onStartSplitting).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id }))
  })

  it('既に割勘済みの仕訳には「割勘する」ボタンが表示されない(割勘対象候補の絞り込み)', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
    })
    const original = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '既に割勘済みの支出',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalEntryId: original.id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        projectId: project.id,
        amount: 500,
        entryDate: '2026-08-02',
      }),
    )

    renderScreen()
    const item = (await screen.findByText('既に割勘済みの支出')).closest('li') as HTMLElement

    expect(within(item).queryByRole('button', { name: '割勘する' })).not.toBeInTheDocument()
  })
})
