// @vitest-environment jsdom
/**
 * 確定済み仕訳一覧画面(計画Issue #40、テーブル化・フィルタ接続は計画Issue #125)の
 * コンポーネントテスト。journal_entriesを日付・摘要・取引金額のタスク指向の表現
 * (借方/貸方等の簿記用語を見せない形)でテーブル表示し、共通コンポーネント
 * JournalEntryFilterForm(期間・科目・世帯メンバー・プロジェクト)による絞り込みと、
 * 選択した仕訳の詳細画面への遷移を、sql.jsのNode実装(createTestDatabase)を使った
 * 統合的なレンダリングテストとして検証する。本画面は仕訳確認専用であり、割勘起票への
 * 導線は持たない(ユーザーレビューで割勘対象の選択を専用のExpenseSplittingEntryPickerScreen
 * へ分離した、計画Issue #40)。下書き一覧(JournalEntryDraftListScreen)とは別物で、
 * 確定済み仕訳のみを対象とする。インライン編集は行わず、1仕訳=1行のサマリー表示と
 * 詳細画面への遷移にとどめる(計画Issue #125、複数行の貸借を持つ仕訳のインライン編集は
 * JournalEntryDetailScreenのLinesテーブルに委ねる設計判断)。外部依存: sql.js(ネットワーク
 * アクセスなし)。
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
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { JournalEntryListScreen } from './JournalEntryListScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let projectRepository: SqlJsProjectRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
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
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        projectRepository={projectRepository}
        onSelectEntry={onSelectEntry}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
  return { onSelectEntry, onBack }
}

/** 一覧テーブルの行(ヘッダー行を除く)を取得する */
async function findEntryRows(): Promise<HTMLElement[]> {
  return (await screen.findAllByRole('row')).slice(1)
}

describe('JournalEntryListScreen', () => {
  it('確定済み仕訳が0件の場合、空状態メッセージが表示される', async () => {
    renderScreen()

    expect(await screen.findByText('確定済みの仕訳はまだありません')).toBeInTheDocument()
  })

  it('確定済み仕訳が日付・摘要・取引金額とともにテーブル表示される', async () => {
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

    const rows = await findEntryRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('2026-08-01')
    expect(rows[0]).toHaveTextContent('スーパーで食材購入')
    expect(rows[0]).toHaveTextContent('￥3,000')
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

  it('科目で絞り込むと、該当する仕訳のみがテーブルに表示される(JournalEntryFilterForm接続)', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const transport = accountRepository.create({ category: 'expense', name: '交通費', isReconcilable: null })
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
    journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '電車代',
      householdMemberId: member.id,
      lines: [
        { accountId: transport.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    renderScreen()
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: String(transport.id) } })

    const rows = await findEntryRows()
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('電車代')).toBeInTheDocument()
    expect(screen.queryByText('スーパーで食材購入')).not.toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const { onBack } = renderScreen()
    await screen.findByText('確定済みの仕訳はまだありません')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
