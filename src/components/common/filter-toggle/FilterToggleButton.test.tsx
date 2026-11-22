// @vitest-environment jsdom
/**
 * FilterToggleButton(絞り込みの開閉ボタン、計画Issue #266)のコンポーネントテスト。
 *
 * 仕訳一覧・明細取込・割勘など、絞り込み欄を持つ画面が共通で使うアイコンボタン。文字は出さず、
 * ファンネルのアイコンと、適用中の条件の数のバッジだけを出す。開閉の状態そのものは呼び出し側が持つ制御コンポーネント。
 * 外部依存(DB・ネットワーク)はなく、ユーザー操作は fireEvent で再現する。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilterToggleButton } from './FilterToggleButton'

afterEach(cleanup)

describe('FilterToggleButton', () => {
  it('閉じていて条件がないときは「絞り込みを開く」ボタンで、件数バッジは出ない', () => {
    render(<FilterToggleButton open={false} activeCount={0} onToggle={() => {}} />)

    const button = screen.getByRole('button', { name: '絞り込みを開く' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('filter-toggle-badge')).not.toBeInTheDocument()
  })

  it('開いているときは「絞り込みを閉じる」ボタンで、aria-expanded が true になる', () => {
    render(<FilterToggleButton open activeCount={0} onToggle={() => {}} />)

    expect(screen.getByRole('button', { name: '絞り込みを閉じる' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('条件が1件以上あるときは、閉じていても件数バッジに数が出て、ボタンの名前にも件数が入る', () => {
    render(<FilterToggleButton open={false} activeCount={2} onToggle={() => {}} />)

    expect(screen.getByTestId('filter-toggle-badge')).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: '絞り込みを開く(2件適用中)' })).toBeInTheDocument()
  })

  it('押すと onToggle が1回呼ばれる', () => {
    const onToggle = vi.fn()
    render(<FilterToggleButton open={false} activeCount={0} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを開く' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('aria-controls で、開閉する絞り込み欄の id を指せる', () => {
    render(<FilterToggleButton open activeCount={0} onToggle={() => {}} controlsId="journal-filter-panel" />)

    expect(screen.getByRole('button', { name: '絞り込みを閉じる' })).toHaveAttribute('aria-controls', 'journal-filter-panel')
  })
})
