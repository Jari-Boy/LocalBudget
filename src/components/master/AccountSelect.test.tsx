// @vitest-environment jsdom
/**
 * AccountSelect(科目を1つ選ぶ共通の選択欄、計画Issue #234)のコンポーネントテスト。
 * 科目と科目グループを受け取り、区分・グループの階層(インデント)・検索・Enter確定・先頭固定の特別な項目・
 * 絞り込み条件(filter)・現在の値(無効でも残す)が、部品の中で行われることを検証する。
 * 外部依存なし(DB・Repositoryに依存せず、科目とグループの配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import { AccountSelect } from './AccountSelect'

afterEach(cleanup)

const account = (id: number, name: string, category: AccountCategory, accountGroupId: number | null, extra: Partial<Account> = {}): Account => ({
  id,
  category,
  name,
  isReconcilable: null,
  hasExternalStatement: null,
  isActive: true,
  isSystemManaged: false,
  autoBalanceAdjustment: false,
  householdMemberId: null,
  accountGroupId,
  sortOrder: id,
  createdAt: '',
  updatedAt: '',
  ...extra,
})

const group = (id: number, name: string, category: AccountGroup['category'], parentGroupId: number | null = null): AccountGroup => ({
  id,
  name,
  parentGroupId,
  category,
  sortOrder: id,
  isActive: true,
  createdAt: '',
  updatedAt: '',
})

const groups = [group(1, '食費', 'expense'), group(2, '外食', 'expense', 1)]
const accounts = [
  account(10, '昼食', 'expense', 2),
  account(11, '食材', 'expense', 1),
  account(12, '給与収入', 'revenue', null),
  account(13, '旧科目', 'expense', null, { isActive: false }),
  account(14, '立替金', 'asset', null, { isSystemManaged: true }),
]

const open = () => fireEvent.click(screen.getByRole('button', { name: /^科目/ }))
/** 開いて検索語を入れる(グループは既定で折りたたまれているが、検索中は該当する科目まで展開される) */
const openAndSearch = (query: string) => {
  open()
  fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: query } })
}

describe('AccountSelect', () => {
  it('検索すると、該当する科目と、その親のグループが階層どおりに出る', () => {
    render(<AccountSelect label="科目" accounts={accounts} accountGroups={groups} value="" onChange={vi.fn()} />)
    openAndSearch('昼')
    expect(screen.getByText('費用')).toBeInTheDocument()
    expect(screen.getByText('食費')).toHaveStyle({ paddingLeft: '8px' })
    expect(screen.getByText('外食')).toHaveStyle({ paddingLeft: '24px' })
    expect(screen.getByRole('button', { name: '昼食' })).toBeInTheDocument()
  })

  it('科目を選ぶと、科目のidの文字列で onChange が呼ばれる', () => {
    const onChange = vi.fn()
    render(<AccountSelect label="科目" accounts={accounts} accountGroups={groups} value="" onChange={onChange} />)
    openAndSearch('昼')
    fireEvent.click(screen.getByRole('button', { name: '昼食' }))
    expect(onChange).toHaveBeenCalledWith('10')
  })

  it('ひらがなで検索して1件に絞れたら、Enter で確定できる', () => {
    const onChange = vi.fn()
    render(
      <AccountSelect label="科目" accounts={[account(20, 'サンドラッグ', 'expense', null), ...accounts]} accountGroups={groups} value="" onChange={onChange} />,
    )
    open()
    const search = screen.getByLabelText('科目を検索')
    fireEvent.change(search, { target: { value: 'さんどらっぐ' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('20')
  })

  it('filterに合わない科目は候補に出さない(システム管理の科目を除く、など)', () => {
    render(
      <AccountSelect label="科目" accounts={accounts} accountGroups={groups} filter={(a) => a.isActive && !a.isSystemManaged} value="" onChange={vi.fn()} />,
    )
    openAndSearch('')
    fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: '金' } })
    expect(screen.queryByRole('button', { name: '立替金' })).toBeNull()
    fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: '旧' } })
    expect(screen.queryByRole('button', { name: '旧科目' })).toBeNull()
    fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: '昼' } })
    expect(screen.getByRole('button', { name: '昼食' })).toBeInTheDocument()
  })

  it('filterに合わなくても、現在の値の科目は残す', () => {
    render(
      <AccountSelect label="科目" accounts={accounts} accountGroups={groups} filter={(a) => a.isActive} value="13" onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: '科目: 旧科目' })).toBeInTheDocument()
  })

  it('emptyLabelを渡すと、先頭に未選択の項目を出し、選ぶと空文字で onChange が呼ばれる', () => {
    const onChange = vi.fn()
    render(<AccountSelect label="科目" accounts={accounts} accountGroups={groups} value="10" onChange={onChange} emptyLabel="未設定" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '未設定' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('leadingOptionsを渡すと、特別な項目を先頭に固定して選べる', () => {
    const onChange = vi.fn()
    render(
      <AccountSelect
        label="科目"
        accounts={accounts}
        accountGroups={groups}
        value="__keep"
        onChange={onChange}
        leadingOptions={[
          { value: '__keep', label: '変更しない' },
          { value: '__clear', label: '未設定にする' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: '科目: 変更しない' })).toBeInTheDocument()
    open()
    fireEvent.click(screen.getByRole('button', { name: '未設定にする' }))
    expect(onChange).toHaveBeenCalledWith('__clear')
  })

  it('pinnedを渡すと、該当する科目を、階層ではなく先頭の見出しの下にまとめて出す(階層のほうには出さない)', () => {
    render(
      <AccountSelect
        label="科目"
        accounts={accounts}
        accountGroups={groups}
        value=""
        onChange={vi.fn()}
        pinned={{ name: '紐づけ済みの科目', filter: (a) => a.id === 11 }}
      />,
    )
    open()
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    expect(screen.getByText('紐づけ済みの科目')).toBeInTheDocument()
    expect(names.filter((n) => n === '食材')).toHaveLength(1)
    // 階層のほうは検索で開いても、固定した科目を重ねて出さない
    fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: '食' } })
    expect(screen.getAllByRole('button', { name: '食材' })).toHaveLength(1)
  })

  it('disabledのときは、押せない', () => {
    render(<AccountSelect label="科目" accounts={accounts} accountGroups={groups} value="" onChange={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /^科目/ })).toBeDisabled()
  })
})
