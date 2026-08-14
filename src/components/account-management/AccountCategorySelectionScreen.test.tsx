// @vitest-environment jsdom
/**
 * 科目カテゴリ選択画面(計画Issue #95)のコンポーネントテスト。科目管理ハブ画面の
 * 「科目を追加する」導線から遷移し、「資産(口座)を登録する」「クレジットカードを
 * 登録する」「その他の科目を追加する」の3択でそれぞれ対応するコールバックを呼び分ける
 * ことを検証する。DB・Repositoryへの依存を持たない純粋な表示・ナビゲーション
 * コンポーネント。外部依存: なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { AccountCategorySelectionScreen } from './AccountCategorySelectionScreen'

afterEach(cleanup)

function renderScreen(overrides: Partial<Parameters<typeof AccountCategorySelectionScreen>[0]> = {}) {
  const onSelectAsset = vi.fn()
  const onSelectCreditCard = vi.fn()
  const onSelectOther = vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <AccountCategorySelectionScreen
        onSelectAsset={onSelectAsset}
        onSelectCreditCard={onSelectCreditCard}
        onSelectOther={onSelectOther}
        onBack={onBack}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onSelectAsset, onSelectCreditCard, onSelectOther, onBack }
}

describe('AccountCategorySelectionScreen', () => {
  it('各選択肢に、対象範囲が伝わる短い説明文が併記される(粒度の異なる選択肢が並ぶことによる混乱を防ぐ)', () => {
    renderScreen()

    expect(screen.getByText('銀行口座・現金・電子マネー・証券口座')).toBeInTheDocument()
    expect(screen.getByText('クレジットカード専用の科目を作成します')).toBeInTheDocument()
    expect(
      screen.getByText('収益・費用や、未収金・立替金など特殊な資産・負債を追加します'),
    ).toBeInTheDocument()
  })

  it('「資産を登録する」を選ぶとonSelectAssetが呼ばれる', () => {
    const { onSelectAsset } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '資産を登録する' }))

    expect(onSelectAsset).toHaveBeenCalledTimes(1)
  })

  it('「クレジットカードを登録する」を選ぶとonSelectCreditCardが呼ばれる', () => {
    const { onSelectCreditCard } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'クレジットカードを登録する' }))

    expect(onSelectCreditCard).toHaveBeenCalledTimes(1)
  })

  it('「その他の科目を追加する」を選ぶとonSelectOtherが呼ばれる', () => {
    const { onSelectOther } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'その他の科目を追加する' }))

    expect(onSelectOther).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', () => {
    const { onBack } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
