// @vitest-environment jsdom
/**
 * 割勘対象選択画面(計画Issue #40、ユーザーレビューで割勘対象の仕訳選択を仕訳一覧
 * (確認用途の汎用画面)から分離した専用の入口画面)のコンポーネントテスト。
 * findUnallocatedEntries(docs/domain/expense-splitting.md 1.5節)による「既に割勘済み
 * の仕訳の除外」と、JournalEntryFilterForm(期間・科目・世帯メンバー・プロジェクト)
 * による追加の絞り込みを組み合わせて対象候補を一覧表示し、チェックボックスで選択した
 * 仕訳をまとめて割勘起票フォームへ渡す動線(計画Issue #40 Attempt 4、人間レビューでの
 * 「複数の元仕訳をまとめて選択して一括で割勘起票したい」との指摘への対応)を、
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして
 * 検証する。外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { ExpenseSplittingEntryPickerScreen } from './ExpenseSplittingEntryPickerScreen'

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

function renderScreen(overrides?: { onSelectEntries?: (entries: JournalEntry[]) => void; onBack?: () => void }) {
  const onSelectEntries = overrides?.onSelectEntries ?? vi.fn()
  const onBack = overrides?.onBack ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ExpenseSplittingEntryPickerScreen
        journalEntryRepository={journalEntryRepository}
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        projectRepository={projectRepository}
        onSelectEntries={onSelectEntries}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
  return { onSelectEntries, onBack }
}

describe('ExpenseSplittingEntryPickerScreen', () => {
  it('未割勘の仕訳が候補として一覧表示され、既に割勘済みの仕訳は除外される', async () => {
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
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'まだ割勘していない支出',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const alreadySplit = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '既に割勘済みの支出',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })
    journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalEntryId: alreadySplit.id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        projectId: project.id,
        amount: 250,
        entryDate: '2026-08-03',
      }),
    )

    renderScreen()

    expect(await screen.findByText('まだ割勘していない支出')).toBeInTheDocument()
    expect(screen.queryByText('既に割勘済みの支出')).not.toBeInTheDocument()
  })

  it('科目で絞り込むと、一致しない仕訳が一覧から除外される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const foodExpense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const transportExpense = accountRepository.create({
      category: 'expense',
      name: '交通費',
      isReconcilable: null,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食費の支出',
      householdMemberId: member.id,
      lines: [
        { accountId: foodExpense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '交通費の支出',
      householdMemberId: member.id,
      lines: [
        { accountId: transportExpense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    renderScreen()
    await screen.findByText('食費の支出')

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: String(foodExpense.id) } })

    expect(await screen.findByText('食費の支出')).toBeInTheDocument()
    expect(screen.queryByText('交通費の支出')).not.toBeInTheDocument()
  })

  it('チェックボックスで1件選択し「選択した仕訳で割勘する」ボタンを押すと、対応する仕訳を含む配列でonSelectEntriesが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onSelectEntries } = renderScreen()
    await screen.findByText('スーパーで食材購入')

    fireEvent.click(screen.getByRole('checkbox', { name: 'スーパーで食材購入を選択する' }))
    fireEvent.click(screen.getByRole('button', { name: '選択した仕訳で割勘する' }))

    expect(onSelectEntries).toHaveBeenCalledTimes(1)
    expect(onSelectEntries).toHaveBeenCalledWith([expect.objectContaining({ id: entry.id })])
  })

  it('複数の仕訳をチェックボックスで選択すると、一覧に表示されている順序でonSelectEntriesが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry1 = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'まとめ選択テスト1',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const entry2 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: 'まとめ選択テスト2',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    const { onSelectEntries } = renderScreen()
    await screen.findByText('まとめ選択テスト1')

    fireEvent.click(screen.getByRole('checkbox', { name: 'まとめ選択テスト2を選択する' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'まとめ選択テスト1を選択する' }))
    fireEvent.click(screen.getByRole('button', { name: '選択した仕訳で割勘する' }))

    expect(onSelectEntries).toHaveBeenCalledWith([
      expect.objectContaining({ id: entry1.id }),
      expect.objectContaining({ id: entry2.id }),
    ])
  })

  it('仕訳を1件も選択していない間は「選択した仕訳で割勘する」ボタンが無効化される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen()
    await screen.findByText('スーパーで食材購入')

    expect(screen.getByRole('button', { name: '選択した仕訳で割勘する' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'スーパーで食材購入を選択する' }))

    expect(screen.getByRole('button', { name: '選択した仕訳で割勘する' })).toBeEnabled()
  })

  it('候補が0件の場合、空状態メッセージが表示される', async () => {
    renderScreen()

    expect(await screen.findByText('割勘の対象となる仕訳がありません')).toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const { onBack } = renderScreen()
    await screen.findByText('割勘の対象となる仕訳がありません')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
