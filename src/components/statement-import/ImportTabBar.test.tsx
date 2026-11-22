// @vitest-environment jsdom
/**
 * ImportTabBar(明細取込画面の一覧のタブ見出し、計画Issue #263)のコンポーネントテスト。
 * タブの切り替え(選択中の表示・押したときの通知・矢印キーでの移動)、件数、確認が必要なタブに付く状態の札
 * (黄色=未入力・似た取引、赤=要対応)、確認不要なタブが目立たない見た目になることを確認する。
 * 外部依存はなし(コールバックはvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportTabBar, type ImportTabItem } from './ImportTabBar'

afterEach(cleanup)

const TABS: ImportTabItem[] = [
  {
    key: 'new',
    label: '新規',
    count: 376,
    states: [
      { tone: 'todo', text: '似た取引 4' },
      { tone: 'todo', text: '未入力 332' },
    ],
  },
  { key: 'duplicate', label: '重複', count: 11, muted: true },
  { key: 'unreadable', label: '取り込まない行', count: 11, muted: true },
]

function renderBar(overrides: Partial<Parameters<typeof ImportTabBar>[0]> = {}) {
  const onSelect = vi.fn()
  render(<ImportTabBar label="一覧の種類" tabs={TABS} active="new" onSelect={onSelect} {...overrides} />)
  return { onSelect }
}

describe('ImportTabBar', () => {
  it('タブごとに名前と件数を出し、選択中のタブだけ aria-selected が true になる', () => {
    renderBar({ active: 'duplicate' })

    const tabs = within(screen.getByRole('tablist', { name: '一覧の種類' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['新規376似た取引 4未入力 332', '重複11', '取り込まない行11'])
    expect(screen.getByRole('tab', { name: /^重複/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^新規/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('タブを押すと、そのタブのキーで通知する', () => {
    const { onSelect } = renderBar()

    fireEvent.click(screen.getByRole('tab', { name: /^取り込まない行/ }))

    expect(onSelect).toHaveBeenCalledWith('unreadable')
  })

  it('確認が必要なタブには、状態の札を色の種類(黄色・赤)のクラスつきで出す', () => {
    renderBar({
      tabs: [{ ...TABS[0], states: [{ tone: 'error', text: '要対応 2' }, { tone: 'todo', text: '未入力 332' }] }, ...TABS.slice(1)],
    })

    expect(screen.getByText('要対応 2')).toHaveClass('import-tab__state', 'import-tab__state--error')
    expect(screen.getByText('未入力 332')).toHaveClass('import-tab__state', 'import-tab__state--todo')
  })

  it('確認不要なタブ(muted)は札を持たず、目立たない見た目のクラスが付く', () => {
    renderBar()

    const duplicate = screen.getByRole('tab', { name: /^重複/ })
    expect(duplicate).toHaveClass('import-tab--muted')
    expect(within(duplicate).queryByText(/要対応|未入力|似た取引/)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^新規/ })).not.toHaveClass('import-tab--muted')
  })

  it('選択中のタブだけキーボードの Tab で止まり、→ ← で隣のタブを選べる', () => {
    const { onSelect } = renderBar({ active: 'duplicate' })

    expect(screen.getByRole('tab', { name: /^重複/ })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: /^新規/ })).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(screen.getByRole('tab', { name: /^重複/ }), { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('unreadable')
    fireEvent.keyDown(screen.getByRole('tab', { name: /^重複/ }), { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenLastCalledWith('new')
  })

  it('タブは、そのタブの内容(tabpanel)を aria-controls で指す', () => {
    renderBar()

    expect(screen.getByRole('tab', { name: /^新規/ })).toHaveAttribute('aria-controls', 'import-tabpanel-new')
  })
})
