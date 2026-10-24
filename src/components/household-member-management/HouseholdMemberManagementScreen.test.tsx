// @vitest-environment jsdom
/**
 * 世帯メンバー管理画面(計画Issue #37、計画Issue #127でテーブル形式+行内インライン編集に変更)の
 * コンポーネントテスト。登録済みメンバー(個人・グループ)の一覧表示(テーブルのthead/tbody)、
 * 新規作成(表の最終行に追加される作成用の行から行う)、既存メンバーの名称・種別編集(行をクリックして
 * 入る編集モードでの変更、保存/取消)を、sql.jsのNode実装(createTestDatabase)を使った統合的な
 * レンダリングテストとして検証する。メンバーごとに専用の<tbody>でグルーピングし、グループの
 * 所属メンバーパネルは同じ<tbody>内の追加行として展開する。削除・非アクティブ化は
 * HouseholdMemberManagementScreen.deletion.test.tsx、グループの所属メンバー管理・制約違反
 * エラー表示はHouseholdMemberManagementScreen.group.test.tsxに分離する。
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
import { HouseholdMemberManagementScreen } from './HouseholdMemberManagementScreen'

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

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <HouseholdMemberManagementScreen
        householdMemberRepository={householdMemberRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('HouseholdMemberManagementScreen', () => {
  it('登録済みの個人メンバーが名称とともにテーブル(thead/tbody)で一覧表示される', async () => {
    householdMemberRepository.create({ name: '夫' })

    renderScreen()

    expect(await screen.findByText('夫')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
  })

  it('登録済みのグループにはグループであることを示すラベルが併記される', async () => {
    householdMemberRepository.create({ name: '夫婦', isGroup: true })

    renderScreen()

    const item = (await screen.findByText('夫婦')).closest('tr')!
    expect(item).toHaveTextContent('グループ')
  })

  it('メンバーが0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みの世帯メンバーがいません')).toBeInTheDocument()
  })

  it('種別を指定せず名称のみ入力すると個人メンバーとして作成できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '世帯メンバーを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '妻' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('妻')).toBeInTheDocument()
    const created = householdMemberRepository.findAll()
    expect(created).toHaveLength(1)
    expect(created[0].isGroup).toBe(false)
  })

  it('種別にグループを選択して新規グループを作成できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '世帯メンバーを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '夫婦' } })
    fireEvent.click(screen.getByLabelText('グループ'))
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    const item = (await screen.findByText('夫婦')).closest('tr')!
    expect(item).toHaveTextContent('グループ')
    expect(householdMemberRepository.findAll()[0].isGroup).toBe(true)
  })

  it('作成用の行は取消(キャンセル)できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '世帯メンバーを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書きかけ' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.queryByText('書きかけ')).not.toBeInTheDocument()
    expect(householdMemberRepository.findAll()).toHaveLength(0)
  })

  it('既存メンバーの名称を編集できる', async () => {
    householdMemberRepository.create({ name: '夫' })
    renderScreen()

    const item = (await screen.findByText('夫')).closest('tr')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '夫(改名)' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText('夫(改名)')).toBeInTheDocument()
    expect(screen.queryByText('夫', { exact: true })).not.toBeInTheDocument()
  })

  it('編集中でも他の行は表示専用のままで入力欄を持たない', async () => {
    householdMemberRepository.create({ name: '夫' })
    householdMemberRepository.create({ name: '妻' })
    renderScreen()
    await screen.findByText('夫')

    const editingItem = screen.getByText('夫').closest('tr')!
    fireEvent.click(within(editingItem).getByRole('button', { name: '編集' }))

    expect(within(editingItem).getByLabelText('名称')).toBeInTheDocument()
    const otherItem = screen.getByText('妻').closest('tr')!
    expect(within(otherItem).queryByLabelText('名称')).not.toBeInTheDocument()
  })

  it('編集を取消(キャンセル)すると変更前の値のまま一覧表示に戻る', async () => {
    householdMemberRepository.create({ name: '夫' })
    renderScreen()

    const item = (await screen.findByText('夫')).closest('tr')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '書き換え中' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.getByText('夫')).toBeInTheDocument()
    expect(screen.queryByText('書き換え中')).not.toBeInTheDocument()
  })

  it('編集フォームでは種別(個人/グループ)が現在の値で選択された状態で表示される', async () => {
    householdMemberRepository.create({ name: '夫婦', isGroup: true })
    renderScreen()

    const item = (await screen.findByText('夫婦')).closest('tr')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))

    expect(screen.getByLabelText('グループ')).toBeChecked()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
