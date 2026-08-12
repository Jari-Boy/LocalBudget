// @vitest-environment jsdom
/**
 * プロジェクト管理画面(計画Issue #36)のコンポーネントテスト。
 * 登録済みプロジェクトの一覧表示、新規作成(名称・kind)、既存プロジェクトの編集(名称のみ、
 * kindは作成時のみ指定可能)、削除(紐づく仕訳明細が0件の場合のみ)・非アクティブ化を、
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * プロジェクト別集計・非アクティブ化提案は別ファイルに分離する(計画Issue #36の後続コミット)。
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

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProjectManagementScreen
        projectRepository={projectRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('ProjectManagementScreen', () => {
  it('登録済みプロジェクトが名称とともに一覧表示される', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })

    renderScreen()

    expect(await screen.findByText('26年7月アメリカ旅行')).toBeInTheDocument()
  })

  it('プロジェクトが0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みのプロジェクトがありません')).toBeInTheDocument()
  })

  it('プロジェクトの種別(kind)が一覧に併記される', async () => {
    projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    projectRepository.create({ name: '26年7月アメリカ旅行', kind: 'event' })

    renderScreen()

    const settlementItem = (await screen.findByText('26/7生活費割勘')).closest('li')!
    expect(settlementItem).toHaveTextContent('精算バッチ')
    const eventItem = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    expect(eventItem).toHaveTextContent('イベント')
  })

  it('kindを指定せず名称のみで新規プロジェクトを作成すると、既定のevent種別で作成される', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '26年7月アメリカ旅行' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    expect(item).toHaveTextContent('イベント')
    expect(projectRepository.findAll()).toHaveLength(1)
  })

  it('kindにsettlementを指定して新規プロジェクトを作成できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '26/7生活費割勘' } })
    fireEvent.change(screen.getByLabelText('種別'), { target: { value: 'settlement' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const item = (await screen.findByText('26/7生活費割勘')).closest('li')!
    expect(item).toHaveTextContent('精算バッチ')
  })

  it('既存プロジェクトの名称を編集できる', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })
    renderScreen()

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '26年7月アメリカ旅行(確定)' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText('26年7月アメリカ旅行(確定)')).toBeInTheDocument()
    expect(screen.queryByText('26年7月アメリカ旅行')).not.toBeInTheDocument()
  })

  it('編集フォームには種別(kind)の入力欄が表示されない(作成時のみ指定可能)', async () => {
    projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    renderScreen()

    const item = (await screen.findByText('26/7生活費割勘')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))

    expect(screen.queryByLabelText('種別')).not.toBeInTheDocument()
  })

  it('紐づく仕訳明細が0件のプロジェクトは削除できる', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })
    renderScreen()

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '削除' }))

    await waitFor(() => expect(screen.queryByText('26年7月アメリカ旅行')).not.toBeInTheDocument())
    expect(projectRepository.findAll()).toHaveLength(0)
  })

  it('紐づく仕訳明細が1件以上あるプロジェクトには削除ボタンが表示されず、非アクティブ化のみ可能', async () => {
    const expense = accountRepository.create({ category: 'expense', name: 'お土産代', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26年7月アメリカ旅行' })
    journalEntryRepository.create({
      entryDate: '2026-07-15',
      memo: null,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('li')!
    expect(within(item).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()

    fireEvent.click(within(item).getByRole('button', { name: '非アクティブ化' }))

    await screen.findByText('非アクティブ')
    expect(projectRepository.findAll()[0].isActive).toBe(false)
  })

  it('非アクティブ化されたプロジェクトには非アクティブ化ボタンが表示されない', async () => {
    const project = projectRepository.create({ name: '終了した旅行' })
    projectRepository.deactivate(project.id)

    renderScreen()

    const item = (await screen.findByText('終了した旅行')).closest('li')!
    expect(within(item).queryByRole('button', { name: '非アクティブ化' })).not.toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
