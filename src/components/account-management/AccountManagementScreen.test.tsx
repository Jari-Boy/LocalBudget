// @vitest-environment jsdom
/**
 * 科目管理ハブ画面(計画Issue #95)のコンポーネントテスト。ホーム画面に分散していた
 * 「資産を登録する」「クレジットカードを登録する」「登録済みの科目を見る」の3画面を
 * 統合する入口として、「科目を追加する」「科目一覧を見る」の2つの導線ボタンと
 * 戻るボタンを提供することを検証する。DB・Repositoryへの依存を持たない
 * 純粋な表示・ナビゲーションコンポーネント。外部依存: なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { AccountManagementScreen } from './AccountManagementScreen'

afterEach(cleanup)

function renderScreen(overrides: Partial<Parameters<typeof AccountManagementScreen>[0]> = {}) {
  const onAddAccount = vi.fn()
  const onViewList = vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <AccountManagementScreen
        onAddAccount={onAddAccount}
        onViewList={onViewList}
        onBack={onBack}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onAddAccount, onViewList, onBack }
}

describe('AccountManagementScreen', () => {
  it('「科目を追加する」ボタンを押すとonAddAccountが呼ばれる', () => {
    const { onAddAccount } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '科目を追加する' }))

    expect(onAddAccount).toHaveBeenCalledTimes(1)
  })

  it('「科目一覧を見る」ボタンを押すとonViewListが呼ばれる', () => {
    const { onViewList } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '科目一覧を見る' }))

    expect(onViewList).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', () => {
    const { onBack } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
