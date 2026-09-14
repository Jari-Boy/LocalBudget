// @vitest-environment jsdom
/**
 * 定期取引サブハブ画面(計画Issue #39、Human Override - REJECTによる再設計)のコンポーネント
 * テスト。仕訳ハブ画面(/journal)配下で、定期取引ルール管理・提案の確認という2つの画面への
 * 導線を1つのカテゴリに統合する入口として、2つの導線ボタンと戻るボタンを提供することを
 * 検証する。DB・Repositoryへの依存を持たない純粋な表示・ナビゲーションコンポーネント。
 * 外部依存: なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { RecurringTransactionHubScreen } from './RecurringTransactionHubScreen'

afterEach(cleanup)

function renderScreen(overrides: Partial<Parameters<typeof RecurringTransactionHubScreen>[0]> = {}) {
  const onManageRules = vi.fn()
  const onReviewProposals = vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <RecurringTransactionHubScreen
        onManageRules={onManageRules}
        onReviewProposals={onReviewProposals}
        onBack={onBack}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onManageRules, onReviewProposals, onBack }
}

describe('RecurringTransactionHubScreen', () => {
  it('「ルールを管理する」ボタンを押すとonManageRulesが呼ばれる', () => {
    const { onManageRules } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'ルールを管理する' }))

    expect(onManageRules).toHaveBeenCalledTimes(1)
  })

  it('「定期取引の確認」ボタンを押すとonReviewProposalsが呼ばれる', () => {
    const { onReviewProposals } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '定期取引の確認' }))

    expect(onReviewProposals).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', () => {
    const { onBack } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
