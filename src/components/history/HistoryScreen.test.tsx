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

/** 操作の詳細(計画Issue #295)つきの履歴。一覧の対象名と、右パネルの差分・取込の概要の表示を確かめる */
const DETAIL_OPS: HistoryOperation[] = [
  {
    id: 3,
    label: 'journalEntry.update',
    recordedAt: '2026-11-26T05:30:00.000Z',
    changes: [
      { table: 'journal_entries', inserted: 0, updated: 1, deleted: 0 },
      { table: 'journal_lines', inserted: 0, updated: 2, deleted: 0 },
    ],
    detail: {
      entryTotal: 1,
      dateRange: { from: '2026-11-21', to: '2026-11-21' },
      kinds: { created: 0, updated: 1, deleted: 0 },
      accountUsage: [],
      entries: [
        {
          kind: 'updated',
          entryId: 1,
          before: {
            date: '2026-11-21',
            memo: 'ランチ',
            comment: null,
            lines: [
              { side: 'debit', accountName: '食費', amount: 980 },
              { side: 'credit', accountName: '現金', amount: 980 },
            ],
          },
          after: {
            date: '2026-11-21',
            memo: '日替わりランチ',
            comment: null,
            lines: [
              { side: 'debit', accountName: '食費', amount: 1180 },
              { side: 'credit', accountName: '現金', amount: 1180 },
            ],
          },
        },
      ],
    },
  },
  {
    id: 2,
    label: 'journalEntry.delete',
    recordedAt: '2026-11-26T05:20:00.000Z',
    changes: [
      { table: 'journal_entries', inserted: 0, updated: 0, deleted: 1 },
      { table: 'journal_lines', inserted: 0, updated: 0, deleted: 2 },
    ],
    detail: {
      entryTotal: 1,
      dateRange: { from: '2026-11-20', to: '2026-11-20' },
      kinds: { created: 0, updated: 0, deleted: 1 },
      accountUsage: [],
      entries: [
        {
          kind: 'deleted',
          entryId: 2,
          before: {
            date: '2026-11-20',
            memo: 'スーパー',
            comment: null,
            lines: [
              { side: 'debit', accountName: '食費', amount: 3200 },
              { side: 'credit', accountName: '現金', amount: 3200 },
            ],
          },
          after: null,
        },
      ],
    },
  },
  {
    id: 1,
    label: 'statementImport.confirm',
    recordedAt: '2026-11-26T05:10:00.000Z',
    changes: [
      { table: 'journal_entries', inserted: 248, updated: 0, deleted: 0 },
      { table: 'journal_lines', inserted: 496, updated: 0, deleted: 0 },
      { table: 'external_transaction_refs', inserted: 248, updated: 0, deleted: 0 },
    ],
    meta: {
      kind: 'statementImport',
      institution: '楽天カード',
      targetAccountName: '楽天カード(未払金)',
      files: [
        { name: 'rakuten_202511.csv', count: 142 },
        { name: 'rakuten_202510.csv', count: 106 },
      ],
    },
    detail: {
      entryTotal: 248,
      dateRange: { from: '2026-11-01', to: '2026-11-25' },
      kinds: { created: 248, updated: 0, deleted: 0 },
      accountUsage: [
        { name: '楽天カード(未払金)', count: 248 },
        { name: '食費', count: 86 },
        { name: '交通費', count: 41 },
        { name: '日用品', count: 33 },
        { name: '通信費', count: 12 },
        { name: '書籍', count: 11 },
        { name: '雑費', count: 10 },
      ],
      entries: Array.from({ length: 5 }, (_, i) => ({
        kind: 'created' as const,
        entryId: 10 + i,
        before: null,
        after: {
          date: `2026-11-0${i + 1}`,
          memo: `店${i + 1}`,
          comment: null,
          lines: [
            { side: 'debit' as const, accountName: '食費', amount: 480 },
            { side: 'credit' as const, accountName: '楽天カード(未払金)', amount: 480 },
          ],
        },
      })),
    },
  },
]

describe('HistoryScreen: どの仕訳をどう変えたか(計画Issue #295)', () => {
  it('一覧に、仕訳の対象名(摘要・日付・金額)を出し、編集では変えた項目をタグで出す', async () => {
    setup(DETAIL_OPS)

    const edit = await screen.findByRole('button', { name: /仕訳を編集/ })
    expect(edit).toHaveTextContent('日替わりランチ ・ 2026-11-21 ・ ¥1,180')
    expect(within(edit).getByText('摘要')).toBeInTheDocument()
    expect(within(edit).getByText('金額')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /仕訳を削除/ })).toHaveTextContent('スーパー ・ 2026-11-20 ・ ¥3,200')
  })

  it('CSV取込の行に、金融機関・ファイル名・仕訳の件数と日付の範囲を出す', async () => {
    setup(DETAIL_OPS)

    const row = await screen.findByRole('button', { name: /CSV取込を確定/ })
    expect(row).toHaveTextContent('楽天カード ・ rakuten_202511.csv ほか1ファイル')
    expect(row).toHaveTextContent('仕訳 248件を作成(2026-11-01 〜 2026-11-25)')
  })

  it('編集を選ぶと、右パネルに変わった項目だけを前→後で出す', async () => {
    setup(DETAIL_OPS)
    fireEvent.click(await screen.findByRole('button', { name: /仕訳を編集/ }))

    const panel = await screen.findByRole('complementary')
    expect(await within(panel).findByText('この操作で変わった内容(戻すと左の値になります)')).toBeInTheDocument()
    expect(within(panel).getByText('ランチ')).toBeInTheDocument()
    expect(within(panel).getByText('日替わりランチ')).toBeInTheDocument()
    expect(within(panel).getAllByText('¥980').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('¥1,180').length).toBeGreaterThan(0)
  })

  it('削除を選ぶと、右パネルに削除された内容(復元される内容)を出す', async () => {
    setup(DETAIL_OPS)
    fireEvent.click(await screen.findByRole('button', { name: /仕訳を削除/ }))

    const panel = await screen.findByRole('complementary')
    expect(await within(panel).findByText('この操作で削除された内容(戻すと復元されます)')).toBeInTheDocument()
    expect(within(panel).getByText('スーパー')).toBeInTheDocument()
    expect(within(panel).getAllByText('食費 ¥3,200').length).toBeGreaterThan(0)
  })

  it('CSV取込を選ぶと、金融機関・取込先・ファイルごとの件数・使った科目と、先頭の5件・残りの件数を出す', async () => {
    setup(DETAIL_OPS)
    fireEvent.click(await screen.findByRole('button', { name: /CSV取込を確定/ }))

    const panel = await screen.findByRole('complementary')
    expect(await within(panel).findByText('この操作で作成された仕訳 248件(戻すとすべて削除されます)')).toBeInTheDocument()
    expect(within(panel).getByText('金融機関').nextSibling).toHaveTextContent('楽天カード')
    expect(within(panel).getByText('取込先').nextSibling).toHaveTextContent('楽天カード(未払金)')
    expect(within(panel).getByText('ファイル').nextSibling).toHaveTextContent('rakuten_202511.csv 142件')
    expect(within(panel).getByText('ファイル').nextSibling).toHaveTextContent('rakuten_202510.csv 106件')
    const used = within(panel).getByText('使った科目').nextSibling
    expect(used).toHaveTextContent('食費 86件')
    expect(used).toHaveTextContent('ほか2科目 21件')
    expect(used).not.toHaveTextContent('楽天カード(未払金)')
    expect(within(panel).getByText('仕訳(先頭の5件)')).toBeInTheDocument()
    expect(within(panel).getByText('ほか243件')).toBeInTheDocument()
  })

  it('取込の行で、仕訳以外の表の取消内容(取込の記録)も引き続き出す', async () => {
    setup(DETAIL_OPS)
    fireEvent.click(await screen.findByRole('button', { name: /CSV取込を確定/ }))

    const panel = await screen.findByRole('complementary')
    expect(await within(panel).findByText(/取込の記録 248件を削除する/)).toBeInTheDocument()
  })

  it('詳細の無い操作(仕訳以外)は、これまでどおりの表示で、仕訳の表の取消内容を件数で出す', async () => {
    setup()
    fireEvent.click((await screen.findAllByRole('button', { name: /取込|作成|編集/ }))[0])

    const panel = await screen.findByRole('complementary')
    expect(await within(panel).findByText(/仕訳 2件を元の内容に戻す|仕訳 1件を元の内容に戻す/)).toBeInTheDocument()
  })
})

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
