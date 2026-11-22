// @vitest-environment jsdom
/**
 * 仕訳一覧の末尾に出す「N / 全体件数を表示中」と「さらにN件表示」ボタン(JournalListLoadMore、計画Issue #253)のテスト。
 * 外部依存はない(props だけで描画する部品)。
 * 検証するのは、表示中の件数と全体件数の表示、ボタンの件数(残りがページ分に満たなければ残り件数)、
 * ボタンを押すと onMore が呼ばれること、全件を表示済みなら何も出さないこと。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JournalListLoadMore } from './JournalListLoadMore'

afterEach(cleanup)

describe('JournalListLoadMore', () => {
  it('表示中の件数と全体件数を「200 / 1,234件を表示中」の形で出す', () => {
    render(<JournalListLoadMore total={1234} shown={200} pageSize={200} onMore={() => {}} />)
    expect(screen.getByText('200 / 1,234件を表示中')).toBeInTheDocument()
  })

  it('残りがページ分以上なら「さらに200件表示」ボタンを出し、押すと onMore を呼ぶ', () => {
    const onMore = vi.fn()
    render(<JournalListLoadMore total={1234} shown={200} pageSize={200} onMore={onMore} />)
    fireEvent.click(screen.getByRole('button', { name: 'さらに200件表示' }))
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('残りがページ分に満たないときは、ボタンに残りの件数を出す', () => {
    render(<JournalListLoadMore total={1234} shown={1200} pageSize={200} onMore={() => {}} />)
    expect(screen.getByRole('button', { name: 'さらに34件表示' })).toBeInTheDocument()
  })

  it('全件を表示済みなら、件数もボタンも出さない', () => {
    const { container } = render(<JournalListLoadMore total={150} shown={150} pageSize={200} onMore={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
