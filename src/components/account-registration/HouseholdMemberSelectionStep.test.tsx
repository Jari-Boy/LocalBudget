// @vitest-environment jsdom
/**
 * HouseholdMemberSelectionStep(名義選択ステップの共通UI、計画Issue #92)のコンポーネントテスト。
 * 「名義を選ぶ」ステップのUI(ボタン一覧・戻る/主操作ボタン・エラー表示)を、呼び出し側の
 * props注入によって主操作の文言・活性条件を表現できることに加え、計画Issue #102で追加した
 * 任意選択モード(unspecifiedOptionLabelを渡すと「全員」相当の未選択オプションが表示され、
 * 選択でonSelectにnullが渡される)を検証する。外部依存: react-i18next(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { HouseholdMemberSelectionStep, type HouseholdMemberSelectionStepProps } from './HouseholdMemberSelectionStep'

afterEach(cleanup)

function makeMember(id: number, name: string): HouseholdMember {
  return { id, name, isGroup: false, isActive: true, createdAt: '2026-08-13', updatedAt: '2026-08-13' }
}

const members = [makeMember(1, '太郎'), makeMember(2, '花子')]

function renderStep(overrides: Partial<HouseholdMemberSelectionStepProps> = {}) {
  const onSelect = vi.fn()
  const onBack = vi.fn()
  const onPrimaryAction = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <HouseholdMemberSelectionStep
        householdMembers={members}
        selectedId={null}
        onSelect={onSelect}
        onBack={onBack}
        primaryLabel="次へ"
        primaryDisabled={true}
        onPrimaryAction={onPrimaryAction}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onSelect, onBack, onPrimaryAction }
}

describe('HouseholdMemberSelectionStep', () => {
  it('見出しと世帯メンバーごとのボタンを表示し、「世帯共通」ボタンは表示しない(計画Issue #90)', () => {
    renderStep()
    expect(screen.getByText('名義を選ぶ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '太郎' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '花子' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '世帯共通' })).not.toBeInTheDocument()
  })

  it('世帯メンバーのボタンをクリックするとonSelectにそのidが渡される', () => {
    const { onSelect } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: '花子' }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('selectedIdに一致するボタンのみaria-pressed=trueになる', () => {
    renderStep({ selectedId: 2 })
    expect(screen.getByRole('button', { name: '太郎' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '花子' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('primaryLabel・primaryDisabledが主操作ボタンに反映され、クリックでonPrimaryActionが呼ばれる', () => {
    const { onPrimaryAction } = renderStep({ primaryLabel: '登録する', primaryDisabled: false })
    const primaryButton = screen.getByRole('button', { name: '登録する' })
    expect(primaryButton).toBeEnabled()
    fireEvent.click(primaryButton)
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
  })

  it('primaryDisabled=trueの場合、主操作ボタンは無効化される', () => {
    renderStep({ primaryDisabled: true })
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled()
  })

  it('戻るボタンをクリックするとonBackが呼ばれる', () => {
    const { onBack } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('errorを渡さない場合、alertは表示されない', () => {
    renderStep()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('errorを渡した場合、alertとして表示される', () => {
    renderStep({ error: '登録に失敗しました。もう一度お試しください。' })
    expect(screen.getByRole('alert')).toHaveTextContent('登録に失敗しました。もう一度お試しください。')
  })

  it('unspecifiedOptionLabelを渡さない場合(必須モード)、未選択オプションのボタンは表示されない', () => {
    renderStep()
    expect(screen.queryByRole('button', { name: '全員' })).not.toBeInTheDocument()
  })

  it('unspecifiedOptionLabelを渡した場合(任意モード、計画Issue #102)、そのラベルのボタンが世帯メンバーより前に表示される', () => {
    renderStep({ unspecifiedOptionLabel: '全員' })
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons.indexOf('全員')).toBeGreaterThanOrEqual(0)
    expect(buttons.indexOf('全員')).toBeLessThan(buttons.indexOf('太郎'))
  })

  it('任意モードで未選択オプションのボタンをクリックするとonSelectにnullが渡される', () => {
    const { onSelect } = renderStep({ unspecifiedOptionLabel: '全員', selectedId: 1 })
    fireEvent.click(screen.getByRole('button', { name: '全員' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('任意モードでselectedId = nullの場合、未選択オプションのボタンのみaria-pressed=trueになる', () => {
    renderStep({ unspecifiedOptionLabel: '全員', selectedId: null })
    expect(screen.getByRole('button', { name: '全員' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '太郎' })).toHaveAttribute('aria-pressed', 'false')
  })
})
