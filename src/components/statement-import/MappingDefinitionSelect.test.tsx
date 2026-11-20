// @vitest-environment jsdom
/**
 * MappingDefinitionSelect(取り込みで、CSVに合うマッピング定義が複数あるときに1つ選ぶ共通の選択欄、計画Issue #234)の
 * コンポーネントテスト。候補をフラットに並べ、未選択のときだけplaceholderを出し(候補には出さない)、
 * 検索1件でEnter確定できることを検証する。外部依存なし(定義のidと表示名の配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MappingDefinitionSelect } from './MappingDefinitionSelect'

afterEach(cleanup)

const definitions = [
  { id: 1, label: 'テスト銀行' },
  { id: 2, label: 'テスト銀行 別形式' },
  { id: 3, label: 'サンプルカード' },
]
const open = () => fireEvent.click(screen.getByRole('button', { name: /^マッピング定義/ }))

describe('MappingDefinitionSelect', () => {
  it('未選択のときは、placeholderをボタンに出す', () => {
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="" placeholder="選択してください" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'マッピング定義: 選択してください' })).toBeInTheDocument()
  })

  it('選択中の定義の表示名をボタンに出す', () => {
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="2" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'マッピング定義: テスト銀行 別形式' })).toBeInTheDocument()
  })

  it('定義を選ぶと、そのid(文字列)で通知する', () => {
    const onChange = vi.fn()
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="" placeholder="選択してください" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'サンプルカード' }))
    expect(onChange).toHaveBeenCalledWith('3')
  })

  it('候補は元の並び順で出て、placeholderの文言は候補に出ない', () => {
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="" placeholder="選択してください" onChange={vi.fn()} />)
    open()
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((n) => n === '選択してください' || definitions.some((d) => d.label === n))
    expect(names).toEqual(['テスト銀行', 'テスト銀行 別形式', 'サンプルカード'])
  })

  it('階層がないので、開閉の印は出ない', () => {
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: /を開く|を閉じる/ })).toBeNull()
  })

  it('検索して1件に絞れたら、Enterで確定できる', () => {
    const onChange = vi.fn()
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="" onChange={onChange} />)
    open()
    const search = screen.getByLabelText('マッピング定義を検索')
    fireEvent.change(search, { target: { value: 'サンプル' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('3')
  })

  it('disabledのときは、押せない', () => {
    render(<MappingDefinitionSelect label="マッピング定義" definitions={definitions} value="1" disabled onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^マッピング定義/ })).toBeDisabled()
  })
})
