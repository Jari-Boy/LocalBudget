// @vitest-environment jsdom
/**
 * JournalEntryFilterForm(仕訳の期間・科目・世帯メンバー・プロジェクト絞り込みUI、
 * 計画Issue #40で割勘対象選択画面向けに新設、他画面からの再利用を見据えた共通
 * コンポーネント)のコンポーネントテスト。制御コンポーネントとして、各入力欄の変更が
 * 対応するJournalEntryFilterのフィールドを持つonChangeコールバックを呼ぶことを検証する。
 * 外部依存: なし(React Testing Libraryのみ)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Project } from '../../domain/project/Project'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { JournalEntryFilterForm } from './JournalEntryFilterForm'

afterEach(cleanup)

const accounts: Account[] = [
  {
    id: 10,
    category: 'expense',
    name: '食費',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
]
const householdMembers: HouseholdMember[] = [
  { id: 100, name: 'Aさん', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
]
const projects: Project[] = [
  { id: 5, name: '26/8生活費割勘', kind: 'settlement', isActive: true, createdAt: '', updatedAt: '' },
]

function renderForm(filter: JournalEntryFilter = {}) {
  const onChange = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryFilterForm
        filter={filter}
        onChange={onChange}
        accounts={accounts}
        householdMembers={householdMembers}
        projects={projects}
      />
    </I18nextProvider>,
  )
  return { onChange }
}

describe('JournalEntryFilterForm', () => {
  it('期間(開始日・終了日)・科目・世帯メンバー・プロジェクトの入力欄が表示される', () => {
    renderForm()

    expect(screen.getByLabelText('期間(開始日)')).toBeInTheDocument()
    expect(screen.getByLabelText('期間(終了日)')).toBeInTheDocument()
    expect(screen.getByLabelText('科目')).toBeInTheDocument()
    expect(screen.getByLabelText('世帯メンバー')).toBeInTheDocument()
    expect(screen.getByLabelText('プロジェクト')).toBeInTheDocument()
  })

  it('開始日を入力すると、dateFromを反映したfilterでonChangeが呼ばれる', () => {
    const { onChange } = renderForm()

    fireEvent.change(screen.getByLabelText('期間(開始日)'), { target: { value: '2026-08-01' } })

    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-08-01' })
  })

  it('終了日を入力すると、dateToを反映したfilterでonChangeが呼ばれる', () => {
    const { onChange } = renderForm({ dateFrom: '2026-08-01' })

    fireEvent.change(screen.getByLabelText('期間(終了日)'), { target: { value: '2026-08-31' } })

    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })
  })

  it('科目を選択すると、accountIdを反映したfilterでonChangeが呼ばれる', () => {
    const { onChange } = renderForm()

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: '10' } })

    expect(onChange).toHaveBeenCalledWith({ accountId: 10 })
  })

  it('世帯メンバーを選択すると、householdMemberIdを反映したfilterでonChangeが呼ばれる', () => {
    const { onChange } = renderForm()

    fireEvent.change(screen.getByLabelText('世帯メンバー'), { target: { value: '100' } })

    expect(onChange).toHaveBeenCalledWith({ householdMemberId: 100 })
  })

  it('プロジェクトを選択すると、projectIdを反映したfilterでonChangeが呼ばれる', () => {
    const { onChange } = renderForm()

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: '5' } })

    expect(onChange).toHaveBeenCalledWith({ projectId: 5 })
  })

  it('選択済みの科目を未選択に戻すと、accountIdが取り除かれたfilterでonChangeが呼ばれる', () => {
    const { onChange } = renderForm({ accountId: 10, projectId: 5 })

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith({ projectId: 5 })
  })
})
