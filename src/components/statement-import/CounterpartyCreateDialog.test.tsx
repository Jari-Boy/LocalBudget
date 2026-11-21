// @vitest-environment jsdom
/**
 * CounterpartyCreateDialog(明細取込の「取引先を追加」ダイアログ)のコンポーネントテスト。計画Issue #236の次の点を確認する。
 * (1) 取引先名の初期値に、開いた行の摘要が入る(摘要が空なら名前も空)。
 * (2) 取り込み中の摘要にマッチしないキーワードも、エラーにせず登録できる(注意と「0行」が出る)。
 * (3) キーワードを足したとき、科目の初期値は、ダイアログ内のキーワードで最も多く使われている科目(同数なら指定なし)。
 * 外部依存はなし(Repositoryは持たず、呼び出し側のコールバックをvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { CounterpartyCreateDialog, type CounterpartyCreateDialogProps } from './CounterpartyCreateDialog'

afterEach(cleanup)

const ACCOUNTS: TreeSelectCategory[] = [
  {
    key: 'expense',
    name: '費用',
    nodes: [
      { kind: 'item', value: '10', name: '交通費', isActive: true },
      { kind: 'item', value: '11', name: '食費', isActive: true },
    ],
  },
]

function renderDialog(overrides: Partial<CounterpartyCreateDialogProps> = {}) {
  const onSubmit = vi.fn(async () => undefined)
  render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyCreateDialog
        rowDescription="ジエイアール東日本 スイカチヤージ"
        rowAccountId={10}
        descriptions={['ジエイアール東日本 スイカチヤージ', 'ジエイアール東日本 切符']}
        groups={[]}
        onCreateGroup={vi.fn(async () => 1)}
        accountCategories={ACCOUNTS}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onSubmit }
}

describe('CounterpartyCreateDialog', () => {
  it('取引先名の初期値に、開いた行の摘要が入り、編集できる', () => {
    renderDialog()

    const name = screen.getByLabelText('取引先名')
    expect(name).toHaveValue('ジエイアール東日本 スイカチヤージ')
    fireEvent.change(name, { target: { value: 'ジェイアール東日本' } })
    expect(name).toHaveValue('ジェイアール東日本')
  })

  it('摘要が空の行では、名前も空で、追加できない(必須入力)', () => {
    renderDialog({ rowDescription: '', rowAccountId: null })

    expect(screen.getByLabelText('取引先名')).toHaveValue('')
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('摘要にマッチしないキーワードも、エラーにせず追加できる(注意と0行を出す)', async () => {
    const { onSubmit } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'キーワードを追加' }))
    fireEvent.change(screen.getByLabelText('キーワード2'), { target: { value: 'エキナカ' } })

    expect(screen.getByText('現在の明細の摘要とはマッチしないキーワードです。')).toBeInTheDocument()
    expect(screen.getByText('0行')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          keywords: [
            { text: 'ジエイアール東日本 スイカチヤージ', accountId: 10 },
            { text: 'エキナカ', accountId: 10 },
          ],
        }),
      ),
    )
  })

  it('キーワードを足すと、科目の初期値は、ダイアログ内で最も多く使われている科目になる', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'キーワードを追加' }))

    expect(screen.getByRole('button', { name: /^キーワード2の科目: 交通費/ })).toBeInTheDocument()
  })

  it('科目が同数で並ぶときは、足したキーワードの科目は指定なし', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'キーワードを追加' }))
    // 1つ目: 交通費、2つ目を食費に変えると同数(各1件)になる
    fireEvent.click(screen.getByRole('button', { name: /^キーワード2の科目/ }))
    fireEvent.click(screen.getByRole('button', { name: '食費' }))

    fireEvent.click(screen.getByRole('button', { name: 'キーワードを追加' }))

    expect(screen.getByRole('button', { name: /^キーワード3の科目: 指定なし/ })).toBeInTheDocument()
  })

  it('1つ目のキーワードの科目が未設定(取引先を持てない科目の行)なら、足したキーワードも指定なし', () => {
    renderDialog({ rowAccountId: null })

    fireEvent.click(screen.getByRole('button', { name: 'キーワードを追加' }))

    expect(screen.getByRole('button', { name: /^キーワード2の科目: 指定なし/ })).toBeInTheDocument()
  })
})
