// @vitest-environment jsdom
/**
 * 確定済み仕訳詳細画面(計画Issue #40)のコンポーネントテスト。個々の仕訳明細
 * (科目名・金額・プロジェクト・世帯メンバー・取引先)を借方/貸方等の簿記用語を
 * 見せない形で表示すること、割勘の履歴表示(元の支出→割勘→精算のトレース、
 * docs/domain/expense-splitting.md 1.5節)、取り消し導線(精算前は割勘仕訳の
 * 物理削除、精算後は返金案内メッセージ)を、sql.jsのNode実装(createTestDatabase)
 * を使った統合的なレンダリングテストとして検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { JournalEntryDetailScreen } from './JournalEntryDetailScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen(entryId: number, overrides?: { onBack?: () => void; onDeleted?: () => void }) {
  const onBack = overrides?.onBack ?? vi.fn()
  const onDeleted = overrides?.onDeleted ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryDetailScreen
        entryId={entryId}
        journalEntryRepository={journalEntryRepository}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onBack={onBack}
        onDeleted={onDeleted}
      />
    </I18nextProvider>,
  )
  return { onBack, onDeleted }
}

describe('JournalEntryDetailScreen', () => {
  it('仕訳の日付・摘要・各明細行(科目名・金額)が表示される', async () => {
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

    renderScreen(entry.id)

    expect(await screen.findByText('2026-08-01')).toBeInTheDocument()
    expect(screen.getByText('スーパーで食材購入')).toBeInTheDocument()
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('現金')).toBeInTheDocument()
    expect(screen.getAllByText('￥3,000')).toHaveLength(2)
  })

  it('明細行にプロジェクト・世帯メンバー・取引先が設定されている場合、それぞれの名称が表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/7生活費割勘' })
    const counterparty = counterpartyRepository.create({ name: '友人Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '友人との食事',
      householdMemberId: member.id,
      lines: [
        { accountId: advanceAsset.id, side: 'debit', amount: 500, projectId: project.id, householdMemberId: other.id },
        { accountId: expense.id, side: 'credit', amount: 500, counterpartyId: counterparty.id },
      ],
    })

    renderScreen(entry.id)

    await screen.findByText('2026-08-01')
    expect(screen.getByText('26/7生活費割勘')).toBeInTheDocument()
    expect(screen.getByText('Bさん')).toBeInTheDocument()
    expect(screen.getByText('友人Cさん')).toBeInTheDocument()
  })

  it('割勘・精算と無関係な通常の仕訳では、取り消しセクションが表示されない', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen(entry.id)

    await screen.findByText('2026-08-01')
    expect(screen.queryByRole('button', { name: 'この割勘を取り消す' })).not.toBeInTheDocument()
  })

  it('精算前の割勘仕訳では、取り消し(物理削除)ボタンが表示され、押すと削除されonDeletedが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/7生活費割勘' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const original = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, projectId: project.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, projectId: project.id, householdMemberId: other.id },
      ],
      links: [{ toEntryId: original.id, linkType: 'allocates', amount: 500 }],
    })

    const { onDeleted } = renderScreen(splitEntry.id)
    await screen.findByText('2026-08-02')

    const deleteButton = await screen.findByRole('button', { name: 'この割勘を取り消す' })
    fireEvent.click(deleteButton)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(journalEntryRepository.findById(splitEntry.id)).toBeNull()
  })

  it('精算済みの割勘仕訳では、取り消しボタンの代わりに返金案内メッセージが表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/7生活費割勘' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const original = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, projectId: project.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, projectId: project.id, householdMemberId: other.id },
      ],
      links: [{ toEntryId: original.id, linkType: 'allocates', amount: 500 }],
    })
    journalEntryRepository.create({
      entryDate: '2026-08-10',
      memo: '精算',
      householdMemberId: other.id,
      lines: [
        { accountId: advanceLiability.id, side: 'debit', amount: 500, projectId: project.id, householdMemberId: other.id },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
      links: [{ toEntryId: splitEntry.id, linkType: 'settles', amount: 500 }],
    })

    renderScreen(splitEntry.id)

    expect(await screen.findByText('精算後は新しい取引として現実の返金を記録してください')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この割勘を取り消す' })).not.toBeInTheDocument()
  })

  it('元の支出仕訳の詳細画面で、割勘の履歴(元の支出→割勘→精算)が表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/7生活費割勘' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const original = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, projectId: project.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, projectId: project.id, householdMemberId: other.id },
      ],
      links: [{ toEntryId: original.id, linkType: 'allocates', amount: 500 }],
    })

    renderScreen(original.id)

    expect(await screen.findByText('この支出から生まれた割勘')).toBeInTheDocument()
    expect(screen.getByText('2026-08-02')).toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onBack } = renderScreen(entry.id)
    await screen.findByText('2026-08-01')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
