// @vitest-environment jsdom
/**
 * 勘定科目セレクト(AccountSelect)のコンポーネントテスト(計画Issue #125)。
 * 呼び出し元が注入するfilterで選択肢を絞り込めること、選択・未選択時の
 * onChange呼び出し、disabled状態の反映を検証する。外部依存: なし(純粋なReactコンポーネント)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { Account } from '../../domain/account/Account'
import { AccountSelect } from './AccountSelect'

afterEach(cleanup)

function createAccount(overrides: Partial<Account> & { id: number; name: string }): Account {
  return {
    category: 'expense',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderSelect(overrides?: {
  value?: number | null
  accounts?: Account[]
  onChange?: (accountId: number | null) => void
  filter?: (account: Account) => boolean
  disabled?: boolean
}) {
  const onChange = overrides?.onChange ?? vi.fn()
  const accounts = overrides?.accounts ?? [
    createAccount({ id: 1, name: '食費' }),
    createAccount({ id: 2, name: '現金' }),
  ]
  render(
    <I18nextProvider i18n={i18n}>
      <AccountSelect
        id="test-account-select"
        label="科目"
        value={overrides?.value ?? null}
        accounts={accounts}
        onChange={onChange}
        filter={overrides?.filter}
        disabled={overrides?.disabled}
        i18nNamespace="journal"
      />
    </I18nextProvider>,
  )
  return { onChange, accounts }
}

describe('AccountSelect', () => {
  it('渡された科目一覧がすべて選択肢として表示される', () => {
    renderSelect()

    expect(screen.getByRole('option', { name: '食費' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '現金' })).toBeInTheDocument()
  })

  it('filterで絞り込んだ科目のみが選択肢に表示される', () => {
    renderSelect({ filter: (account) => account.name === '食費' })

    expect(screen.getByRole('option', { name: '食費' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '現金' })).not.toBeInTheDocument()
  })

  it('filterで除外されていても、現在選択中の値と一致する科目は選択肢に残る(非アクティブ化後も既存選択を維持するため)', () => {
    const inactiveAccount = createAccount({ id: 3, name: '解約済み口座', isActive: false })
    renderSelect({
      accounts: [createAccount({ id: 1, name: '食費' }), inactiveAccount],
      value: 3,
      filter: (account) => account.isActive,
    })

    expect(screen.getByRole('option', { name: '解約済み口座' })).toBeInTheDocument()
  })

  it('科目を選択するとonChangeが選択したidで呼ばれる', () => {
    const { onChange } = renderSelect()

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: '2' } })

    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('未選択に戻すとonChangeがnullで呼ばれる', () => {
    const { onChange } = renderSelect({ value: 1 })

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('disabled指定時はセレクトが無効化される', () => {
    renderSelect({ disabled: true })

    expect(screen.getByLabelText('科目')).toBeDisabled()
  })
})
