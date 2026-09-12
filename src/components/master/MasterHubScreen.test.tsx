// @vitest-environment jsdom
/**
 * マスタ管理ハブ画面(計画Issue #118)のコンポーネントテスト。ホーム画面に分散していた
 * 「科目管理」「取引先管理」「世帯メンバー管理」「プロジェクト管理」への導線を
 * マスタ管理という1つのカテゴリに統合する入口として、4つの導線ボタンと戻るボタンを
 * 提供することを検証する。DB・Repositoryへの依存を持たない純粋な表示・ナビゲーション
 * コンポーネント。外部依存: なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { MasterHubScreen } from './MasterHubScreen'

afterEach(cleanup)

function renderScreen(overrides: Partial<Parameters<typeof MasterHubScreen>[0]> = {}) {
  const onManageAccounts = vi.fn()
  const onManageCounterparties = vi.fn()
  const onManageHouseholdMembers = vi.fn()
  const onManageProjects = vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <MasterHubScreen
        onManageAccounts={onManageAccounts}
        onManageCounterparties={onManageCounterparties}
        onManageHouseholdMembers={onManageHouseholdMembers}
        onManageProjects={onManageProjects}
        onBack={onBack}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onManageAccounts, onManageCounterparties, onManageHouseholdMembers, onManageProjects, onBack }
}

describe('MasterHubScreen', () => {
  it('「科目を管理する」ボタンを押すとonManageAccountsが呼ばれる', () => {
    const { onManageAccounts } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '科目を管理する' }))

    expect(onManageAccounts).toHaveBeenCalledTimes(1)
  })

  it('「取引先を管理する」ボタンを押すとonManageCounterpartiesが呼ばれる', () => {
    const { onManageCounterparties } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '取引先を管理する' }))

    expect(onManageCounterparties).toHaveBeenCalledTimes(1)
  })

  it('「世帯メンバーを管理する」ボタンを押すとonManageHouseholdMembersが呼ばれる', () => {
    const { onManageHouseholdMembers } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '世帯メンバーを管理する' }))

    expect(onManageHouseholdMembers).toHaveBeenCalledTimes(1)
  })

  it('「プロジェクトを管理する」ボタンを押すとonManageProjectsが呼ばれる', () => {
    const { onManageProjects } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを管理する' }))

    expect(onManageProjects).toHaveBeenCalledTimes(1)
  })

  it('戻るボタンを押すとonBackが呼ばれる', () => {
    const { onBack } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
