// @vitest-environment jsdom
/**
 * KeywordList(取引先のキーワードの一覧。明細取込の「取引先の設定」・取引先の追加ダイアログで共有)のコンポーネントテスト。
 * 計画Issue #236: 現在の明細の摘要にマッチしない(含む行が0行の)新規キーワードは、エラーにはせず、注意を出すことを確認する。
 * 外部依存はなし(コールバックはvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import { KeywordList, type KeywordListItem } from './KeywordList'

afterEach(cleanup)

const WARNING = '現在の明細の摘要とはマッチしないキーワードです。'

function renderList(items: KeywordListItem[]) {
  render(
    <I18nextProvider i18n={i18n}>
      <KeywordList items={items} onTextChange={vi.fn()} onCommit={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} />
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
