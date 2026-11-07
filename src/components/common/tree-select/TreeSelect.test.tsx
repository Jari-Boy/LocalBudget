// @vitest-environment jsdom
/**
 * 選択ツリー(TreeSelect)のコンポーネントテスト(計画Issue #150)。
 * 科目・取引先・プロジェクトで共通に使うドロップダウン。ボタンの直下に開き、検索欄・区分の見出し・
 * 入れ子のグループ・折りたたみを持つ。グループごとの選択は任意で許可でき、外側のクリックと
 * Escで閉じ、キーボードだけで操作できることを検証する。
 * 外部依存なし(DB・Repositoryに依存せず、汎用のノード型だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeSelect, type TreeSelectProps } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

const item = (value: string, isActive = true) => ({ kind: 'item' as const, value, name: value, isActive })

const categories: TreeSelectCategory[] = [
  {
    key: 'expense',
    name: '費用',
    nodes: [
      {
        kind: 'group',
        id: 'food',
        name: '食費',
        children: [item('外食'), item('食料品')],
      },
      item('雑費'),
    ],
  },
  { key: 'revenue', name: '収益', nodes: [item('給与')] },
]

function renderSelect(overrides: Partial<TreeSelectProps> = {}) {
  const onChange = vi.fn()
  const view = render(
    <div>
      <button type="button">外側</button>
      <TreeSelect
        label="科目"
        categories={categories}
        value=""
        onChange={onChange}
        {...overrides}
      />
    </div>,
  )
  return { onChange, ...view }
}

const trigger = () => screen.getByRole('button', { name: /^科目/ })
const popup = () => screen.getByRole('dialog', { name: '科目' })

describe('TreeSelect', () => {
  it('未選択のときはボタンに「指定なし」を、選択中は項目名を表示する', () => {
    renderSelect()
    expect(trigger()).toHaveTextContent('指定なし')
    cleanup()
    renderSelect({ value: '雑費' })
    expect(trigger()).toHaveTextContent('雑費')
  })

  it('グループを選択中のときは「グループ名(配下すべて)」と表示する', () => {
    renderSelect({ value: 'g:food', allowGroupSelect: true })
    expect(trigger()).toHaveTextContent('食費(配下すべて)')
  })

  it('ボタンを押すとポップアップが開き、検索欄にフォーカスが移る', () => {
    renderSelect()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(within(popup()).getByRole('searchbox', { name: '科目を検索' })).toHaveFocus()
  })

  it('区分の見出しとグループが表示され、グループは最初は閉じている', () => {
    renderSelect()
    fireEvent.click(trigger())
    expect(within(popup()).getByText('費用')).toBeInTheDocument()
    expect(within(popup()).getByText('収益')).toBeInTheDocument()
    const food = within(popup()).getByRole('button', { name: '食費' })
    expect(food).toHaveAttribute('aria-expanded', 'false')
    expect(within(popup()).queryByRole('button', { name: '外食' })).toBeNull()
  })

  it('選択中の項目を含むグループは最初から開いている', () => {
    renderSelect({ value: '外食' })
    fireEvent.click(trigger())
    expect(within(popup()).getByRole('button', { name: '食費' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(popup()).getByRole('button', { name: '外食' })).toHaveAttribute('aria-current', 'true')
  })

  it('グループの見出しを押すと開閉できる', () => {
    renderSelect()
    fireEvent.click(trigger())
    const food = within(popup()).getByRole('button', { name: '食費' })
    fireEvent.click(food)
    expect(within(popup()).getByRole('button', { name: '外食' })).toBeInTheDocument()
    fireEvent.click(food)
    expect(within(popup()).queryByRole('button', { name: '外食' })).toBeNull()
  })

  it('項目を選ぶとonChangeが呼ばれ、ポップアップが閉じてボタンへフォーカスが戻る', () => {
    const { onChange } = renderSelect({ value: '外食' })
    fireEvent.click(trigger())
    fireEvent.click(within(popup()).getByRole('button', { name: '食料品' }))
    expect(onChange).toHaveBeenCalledWith('食料品')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('検索語を入力すると一致する項目だけが残り、グループが自動で開く', () => {
    renderSelect()
    fireEvent.click(trigger())
    fireEvent.change(within(popup()).getByRole('searchbox'), { target: { value: '食料' } })
    expect(within(popup()).getByRole('button', { name: '食料品' })).toBeInTheDocument()
    expect(within(popup()).queryByRole('button', { name: '外食' })).toBeNull()
    expect(within(popup()).queryByRole('button', { name: '雑費' })).toBeNull()
  })

  it('一致する項目がなければ「該当する項目がありません」を表示する', () => {
    renderSelect()
    fireEvent.click(trigger())
    fireEvent.change(within(popup()).getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(within(popup()).getByText('該当する項目がありません')).toBeInTheDocument()
  })

  it('無効な項目は選択中のものを除いて表示しない', () => {
    renderSelect({
      value: '旧科目',
      categories: [{ key: 'a', name: 'A', nodes: [item('現行'), item('旧科目', false), item('廃止', false)] }],
    })
    fireEvent.click(trigger())
    expect(within(popup()).getByRole('button', { name: '旧科目' })).toBeInTheDocument()
    expect(within(popup()).queryByRole('button', { name: '廃止' })).toBeNull()
  })

  it('allowGroupSelectのときだけ、グループに「すべて」ボタンが出てグループ値で選べる', () => {
    const { onChange } = renderSelect({ allowGroupSelect: true })
    fireEvent.click(trigger())
    fireEvent.click(within(popup()).getByRole('button', { name: '食費をすべて選ぶ' }))
    expect(onChange).toHaveBeenCalledWith('g:food')
    cleanup()
    renderSelect()
    fireEvent.click(trigger())
    expect(within(popup()).queryByRole('button', { name: '食費をすべて選ぶ' })).toBeNull()
  })

  it('emptyLabelを渡すと先頭に選択解除の項目が出て、選ぶと空文字で通知する', () => {
    const { onChange } = renderSelect({ value: '雑費', emptyLabel: '指定なし' })
    fireEvent.click(trigger())
    fireEvent.click(within(popup()).getByRole('button', { name: '指定なし' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('Escで閉じてボタンへフォーカスが戻る', () => {
    renderSelect()
    fireEvent.click(trigger())
    fireEvent.keyDown(within(popup()).getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('外側のクリックで閉じる(ポップアップ内のクリックでは閉じない)', () => {
    renderSelect()
    fireEvent.click(trigger())
    fireEvent.pointerDown(within(popup()).getByRole('searchbox'))
    expect(screen.getByRole('dialog', { name: '科目' })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: '外側' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('↓↑キーで検索欄と各行の間をフォーカス移動できる', () => {
    renderSelect({ value: '外食' })
    fireEvent.click(trigger())
    const search = within(popup()).getByRole('searchbox')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    const first = within(popup()).getAllByRole('button')[0]
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(within(popup()).getAllByRole('button')[1]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(search).toHaveFocus()
  })

  it('onCreateを渡すと一覧の末尾に新規追加のボタンが出て、押すと閉じてonCreateが呼ばれる(計画Issue #151)', () => {
    const onCreate = vi.fn()
    renderSelect({ onCreate, createLabel: '科目を新規追加' })
    fireEvent.click(trigger())

    fireEvent.click(within(popup()).getByRole('button', { name: '+ 科目を新規追加' }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '科目' })).not.toBeInTheDocument()
  })

  it('onCreateを渡さなければ新規追加のボタンは出ない', () => {
    renderSelect()
    fireEvent.click(trigger())

    expect(within(popup()).queryByRole('button', { name: /新規追加/ })).not.toBeInTheDocument()
  })

  it('ボタンはlistboxのポップアップを持つことをaria-haspopupで示す', () => {
    renderSelect()
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
  })
})
