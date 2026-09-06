// @vitest-environment jsdom
/**
 * CounterpartyQuickAddSelect(取引先セレクト、その場作成(quick add)対応)のコンポーネント
 * テスト。計画Issue #77(CSV取込レビュー画面)で導入されたコンポーネントを、計画Issue #40
 * (割勘起票フォーム)でも同じ目的(取引先マスタからの選択+その場での新規作成)のUIが
 * 必要になった際、画面ごとに複製せず共通コンポーネントとして再利用できることを検証する
 * (Review Attempt 7の指摘: 複製により発生したCSS当て漏れの再発防止)。呼び出し元ごとに
 * 文言(ラベル・ボタン・エラーメッセージ)を変えられるよう、i18nNamespaceで翻訳名前空間を
 * 受け取ることも検証する。外部依存: なし(React Testing Libraryのみ)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import { CounterpartyQuickAddSelect } from './CounterpartyQuickAddSelect'

afterEach(cleanup)

const counterparties: Counterparty[] = [
  { id: 1, name: '友人Cさん', defaultAccountId: null, isActive: true, createdAt: '', updatedAt: '' },
]

function renderSelect(overrides?: {
  value?: number | null
  i18nNamespace?: string
  onCreate?: (name: string) => Promise<Counterparty>
}) {
  const onChange = vi.fn()
  const onCreate =
    overrides?.onCreate ?? vi.fn(async (name: string) => ({ id: 99, name, defaultAccountId: null, isActive: true, createdAt: '', updatedAt: '' }))
  render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyQuickAddSelect
        id="counterparty-target"
        label="相手"
        value={overrides?.value ?? null}
        counterparties={counterparties}
        onChange={onChange}
        onCreate={onCreate}
        i18nNamespace={overrides?.i18nNamespace ?? 'expenseSplitting'}
      />
    </I18nextProvider>,
  )
  return { onChange, onCreate }
}

describe('CounterpartyQuickAddSelect', () => {
  it('取引先マスタの選択肢が表示され、選ぶとonChangeが呼ばれる', () => {
    const { onChange } = renderSelect()

    fireEvent.change(screen.getByLabelText('相手'), { target: { value: '1' } })

    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('「+ 新しい取引先を作成する」を選ぶと名前入力欄が現れ、作成するとonCreate・onChangeが呼ばれる', async () => {
    const { onChange, onCreate } = renderSelect()

    fireEvent.change(screen.getByLabelText('相手'), { target: { value: '__new__' } })
    fireEvent.change(screen.getByLabelText('新しい取引先の名前'), { target: { value: '新しい友人Dさん' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('新しい友人Dさん'))
    expect(onChange).toHaveBeenCalledWith(99)
    expect(screen.queryByLabelText('新しい取引先の名前')).not.toBeInTheDocument()
  })

  it('作成に失敗すると、名前入力欄はそのままでエラーメッセージが表示される', async () => {
    const onCreate = vi.fn(async () => {
      throw new Error('failed')
    })
    renderSelect({ onCreate })

    fireEvent.change(screen.getByLabelText('相手'), { target: { value: '__new__' } })
    fireEvent.change(screen.getByLabelText('新しい取引先の名前'), { target: { value: '新しい友人Dさん' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('取引先の作成に失敗しました')
    expect(screen.getByLabelText('新しい取引先の名前')).toBeInTheDocument()
  })

  it('キャンセルすると通常のセレクト表示に戻る', () => {
    renderSelect()

    fireEvent.change(screen.getByLabelText('相手'), { target: { value: '__new__' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('新しい取引先の名前')).not.toBeInTheDocument()
    expect(screen.getByLabelText('相手')).toBeInTheDocument()
  })

  it('i18nNamespaceに応じて、呼び出し元の翻訳名前空間の文言が使われる', () => {
    renderSelect({ i18nNamespace: 'statementImport' })

    fireEvent.change(screen.getByLabelText('相手'), { target: { value: '__new__' } })

    // statementImport名前空間の文言(「新しい取引先名」「追加」)がexpenseSplitting名前空間の
    // 文言(「新しい取引先の名前」「作成する」)とは異なる形で表示されることを確認する
    expect(screen.getByLabelText('新しい取引先名')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument()
  })
})
