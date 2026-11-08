// @vitest-environment jsdom
/**
 * 仕訳の詳細パネル(JournalEntryEditor)のコンポーネントテスト(計画Issue #152)。
 * 借方・貸方の2列、列ごとの合計、貸借一致/差額の表示、行の追加・削除、
 * 科目の区分に応じた取引先・精算バッチ・世帯メンバー欄の出し分け、
 * 提案用の「金額だけ編集できる」モードを検証する。
 * 外部依存なし(マスタは props で渡す。科目の選択ツリーは開閉せず、トリガーの表示だけを見る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import { JournalEntryEditor, type JournalEditorLine, type JournalEditorMaster, type JournalEditorValue } from './JournalEntryEditor'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return {
    id,
    category,
    name,
    isReconcilable: category === 'expense' ? null : true,
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
    account(3, '立替金', 'asset', { isReconcilable: false }),
    account(4, '夫の口座', 'asset', { householdMemberId: 1 }),
  ],
  accountCategories: [],
  counterpartyCategories: [],
  projectCategories: [],
  members: [
    { id: 1, name: '夫', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
    { id: 2, name: '妻', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
  ],
  batches: [{ id: 7, name: '旅行', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }],
}

function value(lines: JournalEditorValue['lines']): JournalEditorValue {
  return { entryDate: '2026-10-05', memo: 'ランチ', comment: '', householdMemberId: 1, lines }
}

const debit = (key: number, accountId: number | null, amount: string): JournalEditorLine => ({
  key,
  line: { accountId, side: 'debit' as const, amountInput: amount, projectId: null, householdMemberId: null, counterpartyId: null },
})
const credit = (key: number, accountId: number | null, amount: string): JournalEditorLine => ({
  key,
  line: { accountId, side: 'credit' as const, amountInput: amount, projectId: null, householdMemberId: null, counterpartyId: null },
})

function Harness({ initial, readOnlyLines }: { initial: JournalEditorValue; readOnlyLines?: boolean }) {
  const [v, setV] = useState(initial)
  return <JournalEntryEditor value={v} onChange={setV} master={master} readOnlyLines={readOnlyLines} />
}

describe('JournalEntryEditor', () => {
  it('借方と貸方を2列で表示し、列ごとの合計を出す', () => {
    render(<Harness initial={value([debit(1, 1, '1200'), credit(2, 2, '1200')])} />)
    const debitColumn = screen.getByRole('group', { name: '借方' })
    const creditColumn = screen.getByRole('group', { name: '貸方' })
    expect(within(debitColumn).getByText('￥1,200')).toBeInTheDocument()
    expect(within(creditColumn).getByText('￥1,200')).toBeInTheDocument()
  })

  it('貸借が一致していれば「貸借一致」を表示する', () => {
    render(<Harness initial={value([debit(1, 1, '1200'), credit(2, 2, '1200')])} />)
    expect(screen.getByText('貸借一致')).toBeInTheDocument()
  })

  it('貸借が一致していなければ差額を表示する', () => {
    render(<Harness initial={value([debit(1, 1, '1500'), credit(2, 2, '1000')])} />)
    expect(screen.getByText('差額 ￥500')).toBeInTheDocument()
  })

  it('金額を編集すると合計と差額が更新される', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    fireEvent.change(screen.getByLabelText('食費の金額'), { target: { value: '1800' } })
    expect(screen.getByText('差額 ￥800')).toBeInTheDocument()
  })

  it('「借方の行を追加」で借方に空の行が増える', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    fireEvent.click(screen.getByRole('button', { name: '+ 借方の行を追加' }))
    expect(within(screen.getByRole('group', { name: '借方' })).getAllByLabelText('科目', { exact: false }).length).toBe(2)
  })

  it('その側の最後の1行は削除できない', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.getByRole('button', { name: '食費の行を削除' })).toBeDisabled()
  })

  it('2行以上あれば行を削除できる', () => {
    render(<Harness initial={value([debit(1, 1, '600'), debit(3, 1, '400'), credit(2, 2, '1000')])} />)
    fireEvent.click(screen.getAllByRole('button', { name: '食費の行を削除' })[0])
    expect(screen.getAllByRole('button', { name: '食費の行を削除' })).toHaveLength(1)
  })

  it('費用・収益の行にだけ取引先欄を出す', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.getAllByLabelText('取引先', { exact: false })).toHaveLength(1)
  })

  it('立替金など一時勘定の行にだけ精算バッチ欄を出す', () => {
    render(<Harness initial={value([debit(1, 3, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.getByLabelText('精算バッチ')).toBeInTheDocument()
  })

  it('精算バッチのタグを保持したまま表示する', () => {
    const lines = [debit(1, 3, '1000'), credit(2, 2, '1000')]
    lines[0].line = { ...lines[0].line, settlementBatchId: 7 }
    render(<Harness initial={value(lines)} />)
    expect(screen.getByLabelText('精算バッチ')).toHaveValue('7')
  })

  it('科目に既定の世帯メンバーがあれば「(科目の既定)」と表示して選ばせない', () => {
    render(<Harness initial={value([debit(1, 4, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.getByText('夫(科目の既定)')).toBeInTheDocument()
  })

  it('起票者を表示する', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.getByText('夫', { selector: '.journal-editor__bookkeeper' })).toBeInTheDocument()
  })

  it('摘要・コメントを編集すると onChange に反映される', () => {
    const onChange = vi.fn()
    render(<JournalEntryEditor value={value([debit(1, 1, '1'), credit(2, 2, '1')])} onChange={onChange} master={master} />)
    fireEvent.change(screen.getByLabelText('コメント(任意)'), { target: { value: 'メモ' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comment: 'メモ' }))
  })

  it('readOnlyLines では科目の追加・削除ができず、金額だけ編集できる', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} readOnlyLines />)
    expect(screen.queryByRole('button', { name: '+ 借方の行を追加' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('食費の金額')).not.toBeDisabled()
    expect(screen.getByLabelText('取引日')).toBeDisabled()
  })
})
