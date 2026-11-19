// @vitest-environment jsdom
/**
 * EntitySelect(マスタの実体を選ぶ共通の選択欄、計画Issue #233)のコンポーネントテスト。
 * 実体の種類(科目グループ・取引先グループ・プロジェクトグループ)と、絞り込み条件(filter)だけを受け取り、
 * 階層(インデント)・検索窓・Enter確定・「+ 新規追加」・非アクティブの扱い(選択中なら残す)を部品の中で行うことを検証する。
 * 外部依存なし(DB・Repositoryに依存せず、グループの配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntitySelect } from './EntitySelect'

afterEach(cleanup)

const g = (id: number, name: string, parentGroupId: number | null, category = 'expense', isActive = true) => ({
  id,
  name,
  parentGroupId,
  category,
  sortOrder: id,
  isActive,
})

const groups = [
  g(1, '食費', null),
  g(2, '外食', 1),
  g(3, '給与', null, 'revenue'),
  g(4, '旧グループ', null, 'expense', false),
]

const open = () => fireEvent.click(screen.getByRole('button', { name: /^所属グループ/ }))

describe('EntitySelect', () => {
  it('filterで親が外れても、条件に合う子は候補に残して選べる', () => {
    const onChange = vi.fn()
    render(
      <EntitySelect
       
        label="所属グループ"
        groups={[g(1, '食費', null, 'revenue'), g(2, '外食', 1, 'expense')]}
        filter={(x) => x.category === 'expense'}
        value={null}
        onChange={onChange}
      />,
    )
    open()
    fireEvent.click(screen.getByRole('button', { name: '外食' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('親は最初は畳まれていて、開閉の印を押すと、子が親の下に出る', () => {
    render(<EntitySelect label="所属グループ" groups={groups} value={null} onChange={vi.fn()} />)
    open()
    expect(screen.getByRole('button', { name: '食費' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '外食' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '食費を開く' }))
    expect(screen.getByRole('button', { name: '外食' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '食費を閉じる' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('filterに合わないグループは出さない', () => {
    render(
      <EntitySelect label="所属グループ" groups={groups} filter={(x) => x.category === 'expense'} value={null} onChange={vi.fn()} />,
    )
    open()
    expect(screen.queryByRole('button', { name: '給与' })).toBeNull()
    expect(screen.getByRole('button', { name: '食費' })).toBeInTheDocument()
  })

  it('非アクティブなグループは出さないが、現在の値なら出す', () => {
    const { unmount } = render(<EntitySelect label="所属グループ" groups={groups} value={null} onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: '旧グループ' })).toBeNull()
    unmount()
    render(<EntitySelect label="所属グループ" groups={groups} value={4} onChange={vi.fn()} />)
    open()
    expect(screen.getByRole('button', { name: '旧グループ' })).toBeInTheDocument()
  })

  it('選ぶとidの数値で、未分類を選ぶとnullでonChangeを呼ぶ', () => {
    const onChange = vi.fn()
    render(<EntitySelect label="所属グループ" groups={groups} value={1} onChange={onChange} emptyLabel="未分類" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '食費を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '外食' }))
    expect(onChange).toHaveBeenLastCalledWith(2)
    open()
    fireEvent.click(screen.getByRole('button', { name: '未分類' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('検索でひらがなでもヒットし、1件に絞れたらEnterで確定する', () => {
    const onChange = vi.fn()
    render(
      <EntitySelect
       
        label="所属グループ"
        groups={[g(1, 'ドラッグストア', null)]}
        value={null}
        onChange={onChange}
      />,
    )
    open()
    const search = screen.getByRole('searchbox', { name: '所属グループを検索' })
    fireEvent.change(search, { target: { value: 'どらっぐ' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('onCreateを渡すと「+ 新規追加」を出し、押すとonCreateを呼ぶ', () => {
    const onCreate = vi.fn()
    render(<EntitySelect label="所属グループ" groups={groups} value={null} onChange={vi.fn()} onCreate={onCreate} createLabel="グループを新規追加" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '+ グループを新規追加' }))
    expect(onCreate).toHaveBeenCalled()
  })

  it('グループが無くても、未分類の選択だけ出せる(落ちない)', () => {
    render(<EntitySelect label="所属グループ" groups={[]} value={null} onChange={vi.fn()} emptyLabel="未分類" />)
    open()
    expect(screen.getByRole('button', { name: '未分類' })).toBeInTheDocument()
  })
})
