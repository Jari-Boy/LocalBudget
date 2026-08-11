// @vitest-environment jsdom
/**
 * 仕訳下書き一覧画面(計画Issue #32)のコンポーネントテスト。保存済みの下書き
 * (journal_entry_drafts)を一覧表示し、選択した下書きを再開する導線・削除操作・
 * 新規作成への導線・0件時の空状態表示を、sql.jsのNode実装(createTestDatabase)
 * を使った統合的なレンダリングテストとして検証する。確定済み仕訳(journal_entries)
 * の一覧とは別物である(計画Issue #32の完了条件参照)。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsJournalEntryDraftRepository } from '../../infrastructure/db/SqlJsJournalEntryDraftRepository'
import { JournalEntryDraftListScreen } from './JournalEntryDraftListScreen'

let db: Database
let journalEntryDraftRepository: SqlJsJournalEntryDraftRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  journalEntryDraftRepository = new SqlJsJournalEntryDraftRepository(db)
})

afterEach(cleanup)

function renderScreen(overrides?: { onResume?: (draft: unknown) => void; onNew?: () => void; onBack?: () => void }) {
  const onResume = overrides?.onResume ?? vi.fn()
  const onNew = overrides?.onNew ?? vi.fn()
  const onBack = overrides?.onBack ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryDraftListScreen
        journalEntryDraftRepository={journalEntryDraftRepository}
        onResume={onResume}
        onNew={onNew}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
  return { onResume, onNew, onBack }
}

describe('JournalEntryDraftListScreen', () => {
  it('下書きが0件の場合、空状態メッセージが表示される', async () => {
    renderScreen()

    expect(await screen.findByText('保存されている下書きはありません')).toBeInTheDocument()
  })

  it('保存済みの下書きが日付・摘要・行数とともに一覧表示される', async () => {
    journalEntryDraftRepository.create({
      entryDate: '2026-08-01',
      memo: '先週のスーパー',
      lines: [{ accountId: null, side: null, amount: null }],
    })

    renderScreen()

    const item = (await screen.findByText('先週のスーパー')).closest('li')!
    expect(item).toHaveTextContent('2026-08-01')
    expect(item).toHaveTextContent('1行')
  })

  it('日付・摘要が未入力の下書きは代替テキストで表示される', async () => {
    journalEntryDraftRepository.create({})

    renderScreen()

    const item = (await screen.findByText('日付未入力')).closest('li')!
    expect(item).toHaveTextContent('摘要なし')
  })

  it('複数の下書きが並行して一覧表示される', async () => {
    journalEntryDraftRepository.create({ memo: '下書きA' })
    journalEntryDraftRepository.create({ memo: '下書きB' })

    renderScreen()

    expect(await screen.findByText('下書きA')).toBeInTheDocument()
    expect(screen.getByText('下書きB')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('再開するボタンを押すと、対応する下書きを引数にonResumeが呼ばれる', async () => {
    const draft = journalEntryDraftRepository.create({ memo: '先週のスーパー' })

    const { onResume } = renderScreen()
    await screen.findByText('先週のスーパー')

    fireEvent.click(screen.getByRole('button', { name: '再開する' }))

    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: draft.id }))
  })

  it('削除するボタンを押すと下書きが削除され、一覧から消える', async () => {
    journalEntryDraftRepository.create({ memo: '削除対象の下書き' })

    renderScreen()
    await screen.findByText('削除対象の下書き')

    fireEvent.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(journalEntryDraftRepository.findAll()).toHaveLength(0))
    expect(screen.queryByText('削除対象の下書き')).not.toBeInTheDocument()
  })

  it('新しく入力するボタンを押すとonNewが呼ばれる', async () => {
    const { onNew } = renderScreen()
    await screen.findByText('保存されている下書きはありません')

    fireEvent.click(screen.getByRole('button', { name: '新しく入力する' }))

    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const { onBack } = renderScreen()
    await screen.findByText('保存されている下書きはありません')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
