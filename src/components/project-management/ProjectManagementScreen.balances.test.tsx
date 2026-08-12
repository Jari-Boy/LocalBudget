// @vitest-environment jsdom
/**
 * プロジェクト管理画面(計画Issue #36)のうち、プロジェクト別のPL/BS科目残高内訳表示
 * (summarizeProjectAccountBalances、docs/domain/projects.md 1.4節)と、
 * kind='settlement'かつ精算残高0のプロジェクトへの非アクティブ化提案表示
 * (isSettlementBalanceZero、1.3節・1.5節)を検証するコンポーネントテスト。
 * 一覧表示・作成・編集・削除・非アクティブ化の基本操作はProjectManagementScreen.test.tsx
 * に分離済み。sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテスト。
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
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { ProjectManagementScreen } from './ProjectManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProjectManagementScreen
        projectRepository={projectRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('ProjectManagementScreen(プロジェクト別集計)', () => {
  it('「内訳を表示」を押すと、プロジェクトに紐づく区分別の科目残高が表示される', async () => {
    const souvenir = accountRepository.create({ category: 'expense', name: 'お土産代', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26年7月アメリカ旅行' })
    journalEntryRepository.create({
      entryDate: '2026-07-15',
      memo: null,
      lines: [
        { accountId: souvenir.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '内訳を表示' }))

    expect(within(item).getByText('お土産代')).toBeInTheDocument()
    expect(within(item).getByText('￥5,000')).toBeInTheDocument()
  })

  it('紐づく残高が1件もないプロジェクトは、内訳表示に空状態メッセージが出る', async () => {
    projectRepository.create({ name: '計画中の旅行' })

    renderScreen()

    const item = (await screen.findByText('計画中の旅行')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '内訳を表示' }))

    expect(within(item).getByText('残高のある科目がありません')).toBeInTheDocument()
  })

  it("kind='event'のプロジェクトは、精算残高が0でも非アクティブ化提案が表示されない", async () => {
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26年7月アメリカ旅行', kind: 'event' })
    journalEntryRepository.create({
      entryDate: '2026-07-15',
      memo: null,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    expect(within(item).queryByText('非アクティブ化しますか?')).not.toBeInTheDocument()
  })

  it("kind='settlement'かつ精算残高が0になったプロジェクトには非アクティブ化提案が表示される", async () => {
    const advanceAsset = accountRepository.create({
      category: 'asset',
      name: '立替金(資産)',
      isReconcilable: false,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      memo: null,
      lines: [
        { accountId: advanceAsset.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })
    journalEntryRepository.create({
      entryDate: '2026-07-20',
      memo: null,
      lines: [
        { accountId: cash.id, side: 'debit', amount: 5000 },
        { accountId: advanceAsset.id, side: 'credit', amount: 5000, projectId: project.id },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26/7生活費割勘')).closest('li')!
    expect(within(item).getByText('非アクティブ化しますか?')).toBeInTheDocument()

    // 提案が表示されるだけでは自動的に非アクティブ化されない(docs/domain/projects.md 1.3節)
    expect(projectRepository.findAll()[0].isActive).toBe(true)
  })

  it('非アクティブ化提案のボタンを押すと、プロジェクトが非アクティブ化される', async () => {
    const advanceAsset = accountRepository.create({
      category: 'asset',
      name: '立替金(資産)',
      isReconcilable: false,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      memo: null,
      lines: [
        { accountId: advanceAsset.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })
    journalEntryRepository.create({
      entryDate: '2026-07-20',
      memo: null,
      lines: [
        { accountId: cash.id, side: 'debit', amount: 5000 },
        { accountId: advanceAsset.id, side: 'credit', amount: 5000, projectId: project.id },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26/7生活費割勘')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '非アクティブ化する' }))

    await screen.findByText('非アクティブ')
    expect(projectRepository.findAll()[0].isActive).toBe(false)
  })

  it("kind='settlement'でも精算残高が0でなければ非アクティブ化提案は表示されない", async () => {
    const advanceAsset = accountRepository.create({
      category: 'asset',
      name: '立替金(資産)',
      isReconcilable: false,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      memo: null,
      lines: [
        { accountId: advanceAsset.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26/7生活費割勘')).closest('li')!
    expect(within(item).queryByText('非アクティブ化しますか?')).not.toBeInTheDocument()
  })
})
