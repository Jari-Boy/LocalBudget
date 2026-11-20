// @vitest-environment jsdom
/**
 * MemberSelect(世帯メンバーを1つ選ぶ共通の選択欄、計画Issue #234)のコンポーネントテスト。
 * 階層のないメンバーをフラットに並べ、先頭の特別な項目(未選択・なし・変更しない等)を固定し、
 * 無効なメンバーは現在の値のときだけ残し、検索1件でEnter確定できることを検証する。外部依存なし(メンバーの配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { MemberSelect } from './MemberSelect'

afterEach(cleanup)

const member = (id: number, name: string, isActive = true, isGroup = false): HouseholdMember => ({
  id,
  name,
  isGroup,
  isActive,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

const members = [member(1, '太郎'), member(2, '花子'), member(3, '共有', true, true), member(4, '次郎', false)]
const open = () => fireEvent.click(screen.getByRole('button', { name: /^名義/ }))

describe('MemberSelect', () => {
  it('現在の値のメンバーの名前をボタンに出す', () => {
    render(<MemberSelect label="名義" members={members} value="2" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '名義: 花子' })).toBeInTheDocument()
  })

  it('値が空のときは、emptyLabelをボタンに出す', () => {
    render(<MemberSelect label="名義" members={members} value="" emptyLabel="全員" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '名義: 全員' })).toBeInTheDocument()
  })

  it('メンバーを選ぶと、そのid(文字列)で通知する', () => {
    const onChange = vi.fn()
    render(<MemberSelect label="名義" members={members} value="" emptyLabel="全員" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '花子' }))
    expect(onChange).toHaveBeenCalledWith('2')
  })

  it('emptyLabelの項目を選ぶと、空文字で通知する', () => {
    const onChange = vi.fn()
    render(<MemberSelect label="名義" members={members} value="1" emptyLabel="全員" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '全員' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('共有のメンバー(世帯全体)も、ほかのメンバーと同じ一覧から選べる', () => {
    const onChange = vi.fn()
    render(<MemberSelect label="名義" members={members} value="" emptyLabel="全員" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '共有' }))
    expect(onChange).toHaveBeenCalledWith('3')
  })

  it('無効なメンバーは、現在の値でなければ候補に出ない', () => {
    render(<MemberSelect label="名義" members={members} value="1" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: /次郎/ })).toBeNull()
  })

  it('無効なメンバーでも、現在の値なら候補に残る', () => {
    render(<MemberSelect label="名義" members={members} value="4" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^名義: 次郎/ })).toBeInTheDocument()
    open()
    expect(screen.getAllByText(/次郎/).length).toBeGreaterThan(1)
  })

  it('filterに合わないメンバーは候補に出ない(現在の値は残す)', () => {
    const exceptHanako = (m: HouseholdMember) => m.id !== 2
    render(<MemberSelect label="名義" members={members} filter={exceptHanako} value="1" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: '花子' })).toBeNull()
    expect(screen.getByRole('button', { name: '共有' })).toBeInTheDocument()
  })

  it('leadingOptionsの特別な項目を先頭に出し、選ぶとその値で通知する', () => {
    const onChange = vi.fn()
    const leading = [{ value: 'none', label: '起票者なし' }]
    render(<MemberSelect label="名義" members={members} leadingOptions={leading} value="1" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '起票者なし' }))
    expect(onChange).toHaveBeenCalledWith('none')
  })

  it('階層がないので、開閉の印は出ない', () => {
    render(<MemberSelect label="名義" members={members} value="" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: /を開く|を閉じる/ })).toBeNull()
  })

  it('検索して1件に絞れたら、Enterで確定できる', () => {
    const onChange = vi.fn()
    render(<MemberSelect label="名義" members={members} value="" emptyLabel="全員" onChange={onChange} />)
    open()
    const search = screen.getByLabelText('名義を検索')
    fireEvent.change(search, { target: { value: '花' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('2')
  })

  it('disabledのときは、押せない', () => {
    render(<MemberSelect label="名義" members={members} value="1" disabled onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^名義/ })).toBeDisabled()
  })
})
