// @vitest-environment jsdom
/**
 * 割勘サブハブ画面(計画Issue #118)のコンポーネントテスト。仕訳ハブ画面配下で、
 * 割勘の新規作成・精算・履歴という3つの画面への導線を1つのカテゴリに統合する
 * 入口として、3つの導線ボタンと戻るボタンを提供することを検証する。
 * DB・Repositoryへの依存を持たない純粋な表示・ナビゲーションコンポーネント。
 * 外部依存: なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { ExpenseSplittingHubScreen } from './ExpenseSplittingHubScreen'

afterEach(cleanup)

function renderScreen(overrides: Partial<Parameters<typeof ExpenseSplittingHubScreen>[0]> = {}) {
  const onNewSplit = vi.fn()
  const onSettlement = vi.fn()
  const onHistory = vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ExpenseSplittingHubScreen
        onNewSplit={onNewSplit}
        onSettlement={onSettlement}
        onHistory={onHistory}
        onBack={onBack}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onNewSplit, onSettlement, onHistory, onBack }
}

describe('ExpenseSplittingHubScreen', () => {
  it('「割勘する」ボタンを押すとonNewSplitが呼ばれる', () => {
    const { onNewSplit } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '割勘する' }))

    expect(onNewSplit).toHaveBeenCalledTimes(1)
  })

  it('「精算する」ボタンを押すとonSettlementが呼ばれる', () => {
    const { onSettlement } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '精算する' }))

    expect(onSettlement).toHaveBeenCalledTimes(1)
  })

  it('「割勘の履歴」ボタンを押すとonHistoryが呼ばれる', () => {
    const { onHistory } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '割勘の履歴' }))

    expect(onHistory).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', () => {
    const { onBack } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
