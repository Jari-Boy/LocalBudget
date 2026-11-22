// @vitest-environment jsdom
/**
 * KeywordList(取引先のキーワードの一覧。明細取込の「取引先の設定」・取引先の追加ダイアログで共有)のコンポーネントテスト。
 * 計画Issue #236: 現在の明細の摘要にマッチしない(含む行が0行の)新規キーワードは、エラーにはせず、注意を出すことを確認する。
 * 計画Issue #259: この行に一致したキーワードの強調、ゴミ箱アイコンの削除、キーワードごとの操作欄(renderApply)を確認する。
 * 外部依存はなし(コールバックはvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import { KeywordList, type KeywordListItem } from './KeywordList'

afterEach(cleanup)

const WARNING = '現在の明細の摘要とはマッチしないキーワードです。'

function renderList(items: KeywordListItem[], extra: Partial<Parameters<typeof KeywordList>[0]> = {}) {
  render(
    <I18nextProvider i18n={i18n}>
      <KeywordList items={items} onTextChange={vi.fn()} onCommit={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} {...extra} />
    </I18nextProvider>,
  )
}

describe('KeywordList(摘要にマッチしないキーワードの注意)', () => {
  it('含む行が0行の新規キーワードには注意を出し、「0行」も示す', () => {
    renderList([{ key: 'k0', kind: 'new', text: 'エキナカ', count: 0, error: null }])

    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(screen.getByText('0行')).toBeInTheDocument()
  })

  it('含む行がある新規キーワードには注意を出さない', () => {
    renderList([{ key: 'k0', kind: 'new', text: 'スイカ', count: 3, error: null }])

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('登録済みのキーワードは、0行でも注意を出さない(ほかの月の明細に当たるもののため)', () => {
    renderList([{ key: 'r1', kind: 'registered', text: 'スイカ', count: 0, error: null }])

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('入力前の空欄の新規キーワードには注意を出さない', () => {
    renderList([{ key: 'k0', kind: 'new', text: '', count: 0, error: null }])

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('エラーがあるときは、注意ではなくエラーだけを出す', () => {
    renderList([{ key: 'k0', kind: 'new', text: 'スイカ', count: 0, error: 'duplicate' }])

    expect(screen.getByText('同じキーワードがあります')).toBeInTheDocument()
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })
})

describe('KeywordList(この行に一致・削除・キーワードごとの操作欄。計画Issue #259)', () => {
  it('この行に一致したキーワードには「この行に一致」を出し、一致しないキーワードには出さない', () => {
    renderList([
      { key: 'r1', kind: 'registered', text: 'スイカ', count: 1, error: null, matched: true },
      { key: 'r2', kind: 'registered', text: 'ハヤカケン', count: 0, error: null, matched: false },
    ])

    expect(screen.getAllByText('この行に一致')).toHaveLength(1)
    expect(screen.getByLabelText('キーワード1').closest('.import-settings__pattern')).toHaveClass('import-settings__pattern--matched')
    expect(screen.getByLabelText('キーワード2').closest('.import-settings__pattern')).not.toHaveClass('import-settings__pattern--matched')
  })

  it('削除はaria-label付きのゴミ箱アイコンのボタンで、押すとそのキーワードの削除を呼ぶ', () => {
    const onDelete = vi.fn()
    renderList([{ key: 'r1', kind: 'registered', text: 'スイカ', count: 1, error: null }], { onDelete })

    const button = screen.getByRole('button', { name: 'キーワード1を削除' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button).not.toHaveTextContent('削除')
    fireEvent.click(button)

    expect(onDelete).toHaveBeenCalledWith('r1')
  })

  it('renderApplyを渡すと、キーワードの行ごとに操作欄を出す', () => {
    renderList(
      [
        { key: 'r1', kind: 'registered', text: 'スイカ', count: 1, error: null },
        { key: 'r2', kind: 'registered', text: 'ハヤカケン', count: 0, error: null },
      ],
      { renderApply: (item) => <button type="button">適用:{item.text}</button> },
    )

    expect(screen.getByRole('button', { name: '適用:スイカ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '適用:ハヤカケン' })).toBeInTheDocument()
  })
})
