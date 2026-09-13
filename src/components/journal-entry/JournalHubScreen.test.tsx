// @vitest-environment jsdom
/**
 * 仕訳ハブ画面(計画Issue #118)のコンポーネントテスト。手入力起票・明細取込・仕訳一覧・
 * 割勘という、いずれも最終的にJournalEntryRepositoryを通じて仕訳を生成する起票方法・
 * 派生機能への導線を1つのカテゴリに統合する入口として、4つの導線ボタンと戻るボタンを
 * 提供することを検証する。「手入力で起票」「明細取込」は仕訳作成の対の手段として
 * 対等な2ボタンであることも確認する。DB・Repositoryへの依存を持たない純粋な
 * 表示・ナビゲーションコンポーネント。外部依存: なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { JournalHubScreen } from './JournalHubScreen'

afterEach(cleanup)

function renderScreen(overrides: Partial<Parameters<typeof JournalHubScreen>[0]> = {}) {
  const onManualEntry = vi.fn()
  const onStatementImport = vi.fn()
  const onViewEntries = vi.fn()
  const onSplitting = vi.fn()
  const onRecurringProposals = vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalHubScreen
        onManualEntry={onManualEntry}
        onStatementImport={onStatementImport}
        onViewEntries={onViewEntries}
        onSplitting={onSplitting}
        onRecurringProposals={onRecurringProposals}
        onBack={onBack}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onManualEntry, onStatementImport, onViewEntries, onSplitting, onRecurringProposals, onBack }
}

describe('JournalHubScreen', () => {
  it('「手入力で起票」ボタンを押すとonManualEntryが呼ばれる', () => {
    const { onManualEntry } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))

    expect(onManualEntry).toHaveBeenCalledTimes(1)
  })

  it('「明細取込」ボタンを押すとonStatementImportが呼ばれる', () => {
    const { onStatementImport } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '明細取込' }))

    expect(onStatementImport).toHaveBeenCalledTimes(1)
  })

  it('「仕訳一覧」ボタンを押すとonViewEntriesが呼ばれる', () => {
    const { onViewEntries } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '仕訳一覧' }))

    expect(onViewEntries).toHaveBeenCalledTimes(1)
  })

  it('「割勘」ボタンを押すとonSplittingが呼ばれる', () => {
    const { onSplitting } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '割勘' }))

    expect(onSplitting).toHaveBeenCalledTimes(1)
  })

  it('「定期取引の確認」ボタンを押すとonRecurringProposalsが呼ばれる', () => {
    const { onRecurringProposals } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '定期取引の確認' }))

    expect(onRecurringProposals).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', () => {
    const { onBack } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
