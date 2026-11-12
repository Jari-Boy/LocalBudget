// @vitest-environment jsdom
/**
 * 行編集の共通部品(JournalLinesEditor、計画Issue #180)のコンポーネントテスト。仕訳の起票・編集、定期仕訳の
 * ルールの作成・編集、承認待ちの定期仕訳の確認パネルが共有する、借方・貸方の2列の行編集を検証する:
 * 列ごとの合計と貸借一致/差額の表示、行の追加・削除、読み取り専用(readOnlyLines)のときは科目と行の
 * 追加・削除が編集できず金額だけ編集できること、起票者が未決定(null)でも行を追加できること(定期仕訳のルール)、
 * 科目の区分に応じて取引先・精算バッチの欄が出ること。外部依存なし(マスタは props で渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEditorLine, JournalEditorMaster } from './JournalEntryEditor'
import { JournalLinesEditor } from './JournalLinesEditor'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return {
    id,
    category,
    name,
    isReconcilable: category === 'expense' ? null : false,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

const master: JournalEditorMaster = {
  accounts: [
    account(1, '食費', 'expense'),
    account(2, '楽天カード', 'liability'),
    account(3, '立替金', 'asset', { isSystemManaged: true }),
  ],
  accountCategories: [],
  counterpartyCategories: [],
  projectCategories: [],
  members: [{ id: 1, name: '夫', isGroup: false, isActive: true, createdAt: '', updatedAt: '' }],
  batches: [],
}

const line = (key: number, side: 'debit' | 'credit', accountId: number | null, amount: string): JournalEditorLine => ({
  key,
  line: { accountId, side, amountInput: amount, projectId: null, householdMemberId: 1, counterpartyId: null },
})

function Harness(props: { initial: JournalEditorLine[]; readOnlyLines?: boolean; bookkeeperId?: number | null }) {
  const [lines, setLines] = useState(props.initial)
  return (
    <JournalLinesEditor
      lines={lines}
      onChange={setLines}
      master={master}
      bookkeeperId={props.bookkeeperId === undefined ? 1 : props.bookkeeperId}
      readOnlyLines={props.readOnlyLines}
    />
  )
}

describe('JournalLinesEditor', () => {
  it('借方と貸方を2列で表示し、貸借が一致していれば「貸借一致」を出す', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} />)

    expect(within(screen.getByRole('group', { name: '借方' })).getByText('￥1,200')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('貸借一致')
  })

  it('貸借が一致しないときは差額を出す', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1000')]} />)

    expect(screen.getByRole('status')).toHaveTextContent('差額 ￥200')
  })

  it('行を追加でき、3行以上の複合仕訳も編集できる', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} />)

    fireEvent.click(screen.getByRole('button', { name: '+ 借方の行を追加' }))

    expect(within(screen.getByRole('group', { name: '借方' })).getAllByLabelText(/金額/)).toHaveLength(2)
  })

  it('起票者が未決定(null)でも、行を追加できる(定期仕訳のルール)', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} bookkeeperId={null} />)

    fireEvent.click(screen.getByRole('button', { name: '+ 貸方の行を追加' }))

    expect(within(screen.getByRole('group', { name: '貸方' })).getAllByLabelText(/金額/)).toHaveLength(2)
  })

  it('1行しかない列では、行を削除できない', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} />)

    expect(screen.getByRole('button', { name: '食費の行を削除' })).toBeDisabled()
  })

  it('readOnlyLinesのときは、行の追加を押せず、金額だけ編集できる', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} readOnlyLines />)

    expect(screen.getByRole('button', { name: '+ 借方の行を追加' })).toBeDisabled()
    expect(screen.getByLabelText('食費の金額')).toBeEnabled()
  })

  it('システム管理の立替金の行には、精算バッチの欄が出る(費用の行には出ない)', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 3, '1200')]} />)

    expect(within(screen.getByRole('group', { name: '貸方' })).getByLabelText('精算バッチ')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '借方' })).queryByLabelText('精算バッチ')).toBeNull()
  })
})
