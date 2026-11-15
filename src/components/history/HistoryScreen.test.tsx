// @vitest-environment jsdom
/**
 * 操作履歴画面(HistoryScreen、計画Issue #202)のテスト。
 * 履歴の一覧(新しい順)・0件の表示・保持の注意書き(件数/上限、再読み込みで消える、バックアップに含まれない)、
 * 操作を選ぶと右パネルに「戻す範囲」(件数・影響する仕訳/マスタ・新しい順の取消内容・残る操作の件数)が出ること、
 * 「この時点まで戻す」→画面内の確認→実行の流れ(確認でキャンセルすれば何も戻さない)、取り消し後に一覧を
 * 読み直してお知らせを出すこと、取消が失敗したときにエラーを出して履歴を保つことを検証する。
 * 外部依存: なし。履歴APIは偽物(スタブ)を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryOperation, UndoPreview } from '../../infrastructure/history/OperationHistory'
import i18n from '../../infrastructure/i18n/i18n'
import { HistoryScreen, type HistoryScreenApi } from './HistoryScreen'

afterEach(cleanup)

const OPS: HistoryOperation[] = [
  {
    id: 3,
    label: 'journalEntry.update',
    recordedAt: '2026-11-15T05:32:00.000Z',
    changes: [
      { table: 'journal_entries', inserted: 0, updated: 1, deleted: 0 },
      { table: 'journal_lines', inserted: 0, updated: 2, deleted: 0 },
    ],
  },
  {
    id: 2,
    label: 'statementImport.confirm',
    recordedAt: '2026-11-15T05:30:00.000Z',
    changes: [
      { table: 'journal_entries', inserted: 30, updated: 0, deleted: 0 },
      { table: 'journal_lines', inserted: 60, updated: 0, deleted: 0 },
    ],
  },
  {
    id: 1,
    label: 'counterparty.create',
    recordedAt: '2026-11-15T05:05:00.000Z',
    changes: [{ table: 'counterparties', inserted: 1, updated: 0, deleted: 0 }],
  },
]

function setup(initial: HistoryOperation[] = OPS, overrides: Partial<HistoryScreenApi> = {}) {
  let current = [...initial]
  const api: HistoryScreenApi = {
    list: vi.fn(async () => current),
    limit: vi.fn(async () => 50),
    previewUndoTo: vi.fn(async (id: number): Promise<UndoPreview> => {
      const index = current.findIndex((o) => o.id === id)
      return { operations: current.slice(0, index + 1), keptCount: current.length - index - 1 }
    }),
    undoTo: vi.fn(async (id: number) => {
      const index = current.findIndex((o) => o.id === id)
      const undone = index + 1
      current = current.slice(index + 1)
      return undone
    }),
    ...overrides,
  }
  render(
    <I18nextProvider i18n={i18n}>
      <HistoryScreen history={api} />
    </I18nextProvider>,
  )
  return api
}

describe('HistoryScreen', () => {
  it('履歴を新しい順に並べ、件数/上限と保持の注意書きを出す', async () => {
    setup()

    const items = await screen.findAllByRole('button', { name: /を(作成|編集|確定)|取込/ })
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('仕訳を編集')
    expect(items[2]).toHaveTextContent('取引先を作成')
    expect(screen.getByText(/3 \/ 50件/)).toBeInTheDocument()
    expect(screen.getByText(/再読み込みすると消えます/)).toBeInTheDocument()
    expect(screen.getByText(/バックアップには含まれません/)).toBeInTheDocument()
  })

  it('履歴が0件のときは、戻せる操作がないことを表示する', async () => {
    setup([])

    expect(await screen.findByText('戻せる操作はまだありません')).toBeInTheDocument()
  })

  it('操作を選ぶと、戻す件数・影響する仕訳とマスタの件数・残る操作の件数を右パネルに出す', async () => {
    setup()
    fireEvent.click((await screen.findAllByRole('button', { name: /取込|作成|編集/ }))[1])

    const panel = await screen.findByRole('complementary')
    expect(await within(panel).findByText(/2件の操作を戻します/)).toBeInTheDocument()
    expect(within(panel).getByText(/仕訳.*31.*件に影響/)).toBeInTheDocument()
    expect(within(panel).getByText(/1件の操作は、そのまま残ります/)).toBeInTheDocument()
  })

  it('「この時点まで戻す」で確認を出し、キャンセルすれば何も戻さない', async () => {
    const api = setup()
    fireEvent.click((await screen.findAllByRole('button', { name: /取込|作成|編集/ }))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'この時点まで戻す' }))

    expect(await screen.findByText(/やり直し\(Redo\)できません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(api.undoTo).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'この時点まで戻す' })).toBeInTheDocument()
  })

  it('確認して実行すると、選んだ操作とそれ以降を戻し、一覧を読み直してお知らせを出す', async () => {
    const api = setup()
    fireEvent.click((await screen.findAllByRole('button', { name: /取込|作成|編集/ }))[1])
    fireEvent.click(await screen.findByRole('button', { name: 'この時点まで戻す' }))
    fireEvent.click(await screen.findByRole('button', { name: '2件を戻して保存する' }))

    await waitFor(() => expect(api.undoTo).toHaveBeenCalledWith(2))
    expect(await screen.findByRole('status')).toHaveTextContent('2件の操作を戻して、保存しました。')
    expect(await screen.findByText(/1 \/ 50件/)).toBeInTheDocument()
  })

  it('取消に失敗したらエラーを出し、履歴はそのまま残す', async () => {
    const api = setup(OPS, {
      undoTo: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    fireEvent.click((await screen.findAllByRole('button', { name: /取込|作成|編集/ }))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'この時点まで戻す' }))
    fireEvent.click(await screen.findByRole('button', { name: '1件を戻して保存する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('戻せませんでした')
    expect(api.list).toHaveBeenCalled()
    expect(screen.getByText(/3 \/ 50件/)).toBeInTheDocument()
  })
})
