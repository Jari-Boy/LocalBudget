// @vitest-environment jsdom
/**
 * プロジェクト管理画面(計画Issue #36、計画Issue #127でテーブル形式+行内インライン編集に変更)の
 * コンポーネントテスト。登録済みプロジェクトの一覧表示(テーブルのthead/tbody)、新規作成(名称・kind、
 * 表の最終行に追加される作成用の行から行う)、既存プロジェクトの編集(行内インライン編集、名称のみ、
 * kindは作成時のみ指定可能)、削除(紐づく仕訳明細が0件の場合のみ)・非アクティブ化を、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。プロジェクト別集計・
 * 非アクティブ化提案は別ファイルに分離する(計画Issue #36の後続コミット)。
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
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { ProjectManagementScreen } from './ProjectManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProjectManagementScreen
        projectRepository={projectRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('ProjectManagementScreen', () => {
  it('登録済みプロジェクトが名称とともにテーブル(thead/tbody)で一覧表示される', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })

    renderScreen()

    expect(await screen.findByText('26年7月アメリカ旅行')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '種別' })).toBeInTheDocument()
  })

  it('プロジェクトが0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みのプロジェクトがありません')).toBeInTheDocument()
  })

  it('プロジェクトの種別(kind)が一覧に併記される', async () => {
    projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    projectRepository.create({ name: '26年7月アメリカ旅行', kind: 'event' })

    renderScreen()

    const settlementRow = (await screen.findByText('26/7生活費割勘')).closest('tr')!
    expect(settlementRow).toHaveTextContent('精算')
    const eventRow = (await screen.findByText('26年7月アメリカ旅行')).closest('tr')!
    expect(eventRow).toHaveTextContent('イベント')
  })

  it('kindを指定せず名称のみで新規プロジェクトを作成すると、既定のevent種別で作成される', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '26年7月アメリカ旅行' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const row = (await screen.findByText('26年7月アメリカ旅行')).closest('tr')!
    expect(row).toHaveTextContent('イベント')
    expect(projectRepository.findAll()).toHaveLength(1)
  })

  it('kindにsettlementを指定して新規プロジェクトを作成できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '26/7生活費割勘' } })
    fireEvent.change(screen.getByLabelText('種別'), { target: { value: 'settlement' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const row = (await screen.findByText('26/7生活費割勘')).closest('tr')!
    expect(row).toHaveTextContent('精算')
  })

  it('作成用の行は取消(キャンセル)できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書きかけの旅行' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.queryByText('書きかけの旅行')).not.toBeInTheDocument()
    expect(projectRepository.findAll()).toHaveLength(0)
  })

  it('既存プロジェクトの名称を編集できる', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })
    renderScreen()

    const row = (await screen.findByText('26年7月アメリカ旅行')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '26年7月アメリカ旅行(確定)' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText('26年7月アメリカ旅行(確定)')).toBeInTheDocument()
    expect(screen.queryByText('26年7月アメリカ旅行')).not.toBeInTheDocument()
  })

  it('編集中でも他の行は表示専用のままで入力欄を持たない', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })
    projectRepository.create({ name: '26年8月沖縄旅行' })
    renderScreen()
    await screen.findByText('26年7月アメリカ旅行')

    const editingRow = screen.getByText('26年7月アメリカ旅行').closest('tr')!
    fireEvent.click(within(editingRow).getByRole('button', { name: '編集' }))

    expect(within(editingRow).getByLabelText('名称')).toBeInTheDocument()
    const otherRow = screen.getByText('26年8月沖縄旅行').closest('tr')!
    expect(within(otherRow).queryByLabelText('名称')).not.toBeInTheDocument()
  })

  it('編集中の行には種別(kind)の入力欄が表示されない(作成時のみ指定可能)', async () => {
    projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
    renderScreen()

    const row = (await screen.findByText('26/7生活費割勘')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '編集' }))

    expect(screen.queryByLabelText('種別')).not.toBeInTheDocument()
    expect(within(row).getByText('精算')).toBeInTheDocument()
  })

  it('編集を取消(キャンセル)すると変更前の名称のまま一覧表示に戻る', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })
    renderScreen()

    const row = (await screen.findByText('26年7月アメリカ旅行')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書き換え中' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.getByText('26年7月アメリカ旅行')).toBeInTheDocument()
    expect(screen.queryByText('書き換え中')).not.toBeInTheDocument()
  })

  it('紐づく仕訳明細が0件のプロジェクトは削除できる', async () => {
    projectRepository.create({ name: '26年7月アメリカ旅行' })
    renderScreen()

    const row = (await screen.findByText('26年7月アメリカ旅行')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '削除' }))

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
      householdMemberId: memberId,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })

    renderScreen()

    const row = (await screen.findByText('26年7月アメリカ旅行')).closest('tr')!
    expect(within(row).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: '非アクティブ化' }))

    await waitFor(() => expect(within(row).getByRole('button', { name: 'アクティブ化' })).toBeInTheDocument())
    expect(projectRepository.findAll()[0].isActive).toBe(false)
  })

  it('非アクティブ化されたプロジェクトには非アクティブ化ボタンが表示されない', async () => {
    const project = projectRepository.create({ name: '終了した旅行' })
    projectRepository.deactivate(project.id)

    renderScreen()

    const row = (await screen.findByText('終了した旅行')).closest('tr')!
    expect(within(row).queryByRole('button', { name: '非アクティブ化' })).not.toBeInTheDocument()
  })

  it('非アクティブなプロジェクトにはアクティブ化ボタンが表示され、押すと再度アクティブになる', async () => {
    const project = projectRepository.create({ name: '終了した旅行' })
    projectRepository.deactivate(project.id)

    renderScreen()

    const row = (await screen.findByText('終了した旅行')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: 'アクティブ化' }))

    await waitFor(() =>
      expect(within(row).getByRole('button', { name: '非アクティブ化' })).toBeInTheDocument(),
    )
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
