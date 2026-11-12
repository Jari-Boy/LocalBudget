// @vitest-environment jsdom
/**
 * 仕訳の詳細パネル(JournalEntryEditor)のコンポーネントテスト(計画Issue #152)。
 * 借方・貸方の2列、列ごとの合計、貸借一致/差額の表示、行の追加・削除、
 * 科目の区分に応じた取引先・精算バッチ・世帯メンバー欄の出し分け、
 * 提案用の「金額・摘要・コメントだけ編集できる」モード(計画Issue #164で、行の2段目の取引先・プロジェクト・
 * 世帯メンバーを読み取り専用で表示し、行の追加・削除ボタンを無効で表示するようにした)を検証する。計画Issue #169で、起票者を選べるようにし、
 * 明細行の世帯メンバーは常に1人を選ぶ(既定値は起票者、科目に既定メンバーがあれば固定)ことも検証する。
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
    account(3, '立替金', 'asset', { isReconcilable: false, isSystemManaged: true }),
    account(4, '夫の口座', 'asset', { householdMemberId: 1 }),
    account(5, '未収金', 'asset', { isReconcilable: false }),
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
  line: { accountId, side: 'debit' as const, amountInput: amount, projectId: null, householdMemberId: 1, counterpartyId: null },
})
const credit = (key: number, accountId: number | null, amount: string): JournalEditorLine => ({
  key,
  line: { accountId, side: 'credit' as const, amountInput: amount, projectId: null, householdMemberId: 1, counterpartyId: null },
})

function Harness({ initial, readOnlyLines, lockEntryDate }: { initial: JournalEditorValue; readOnlyLines?: boolean; lockEntryDate?: boolean }) {
  const [v, setV] = useState(initial)
  return <JournalEntryEditor value={v} onChange={setV} master={master} readOnlyLines={readOnlyLines} lockEntryDate={lockEntryDate} />
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

  it('割勘の一時勘定(システム管理の立替金・未払金)の行にだけ精算バッチ欄を出す', () => {
    render(<Harness initial={value([debit(1, 3, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.getByLabelText('精算バッチ')).toBeInTheDocument()
  })

  it('利用者が作った一時勘定(未収金など)の行には精算バッチ欄を出さない', () => {
    render(<Harness initial={value([debit(1, 5, '1000'), credit(2, 2, '1000')])} />)
    expect(screen.queryByLabelText('精算バッチ')).not.toBeInTheDocument()
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

  it('起票者をセレクトで選べ、有効なメンバーが並ぶ(計画Issue #169)', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    const select = screen.getByRole('combobox', { name: '起票者' })
    expect(select).toHaveValue('1')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['夫', '妻'])
  })

  it('明細行の世帯メンバー欄に「メンバーなし」の選択肢は無い', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} />)
    const memberSelects = screen.getAllByRole('combobox', { name: '世帯メンバー' })
    expect(memberSelects.length).toBeGreaterThan(0)
    for (const select of memberSelects) {
      expect(within(select).queryByRole('option', { name: 'メンバーなし' })).not.toBeInTheDocument()
    }
  })

  it('起票者を変えると、旧起票者のままで科目に既定メンバーがない行だけが追従する', () => {
    // 食費(夫のまま)→追従、夫の口座(科目の既定が夫)→固定、食費(妻に手で変更)→そのまま
    const manual = debit(3, 1, '500')
    manual.line = { ...manual.line, householdMemberId: 2 }
    const onChange = vi.fn()
    render(
      <JournalEntryEditor
        value={value([debit(1, 1, '1000'), credit(2, 4, '1500'), manual])}
        onChange={onChange}
        master={master}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: '起票者' }), { target: { value: '2' } })

    const next = onChange.mock.calls[0][0] as JournalEditorValue
    expect(next.householdMemberId).toBe(2)
    expect(next.lines.map((l) => l.line.householdMemberId)).toEqual([2, 1, 2])
  })

  it('行を追加すると、その行の世帯メンバーは起票者になる', () => {
    const onChange = vi.fn()
    render(<JournalEntryEditor value={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} onChange={onChange} master={master} />)

    fireEvent.click(screen.getByRole('button', { name: '+ 借方の行を追加' }))

    const next = onChange.mock.calls[0][0] as JournalEditorValue
    expect(next.lines[next.lines.length - 1].line.householdMemberId).toBe(1)
  })

  it('提案(lockEntryDate)では起票者と取引日を変えられない', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} lockEntryDate />)
    expect(screen.getByRole('combobox', { name: '起票者' })).toBeDisabled()
    expect(screen.getByLabelText('取引日')).toBeDisabled()
  })

  it('摘要・コメントを編集すると onChange に反映される', () => {
    const onChange = vi.fn()
    render(<JournalEntryEditor value={value([debit(1, 1, '1'), credit(2, 2, '1')])} onChange={onChange} master={master} />)
    fireEvent.change(screen.getByLabelText('コメント(任意)'), { target: { value: 'メモ' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comment: 'メモ' }))
  })

  it('readOnlyLines では行の追加・削除ボタンが無効で、金額・摘要・コメントだけ編集できる', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} readOnlyLines />)
    expect(screen.getByRole('button', { name: '+ 借方の行を追加' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ 貸方の行を追加' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: /の行を削除|^行を削除$/ })) expect(button).toBeDisabled()
    expect(screen.getByLabelText('食費の金額')).not.toBeDisabled()
    expect(screen.getByLabelText('取引日')).not.toBeDisabled()
    expect(screen.getByLabelText('摘要(任意)')).not.toBeDisabled()
    expect(screen.getByLabelText('コメント(任意)')).not.toBeDisabled()
  })

  it('readOnlyLines では摘要を編集すると onChange に反映される(確認パネルで摘要を直して確定できる)', () => {
    const onChange = vi.fn()
    render(
      <JournalEntryEditor
        value={value([debit(1, 1, '1000'), credit(2, 2, '1000')])}
        onChange={onChange}
        master={master}
        readOnlyLines
      />,
    )

    fireEvent.change(screen.getByLabelText('摘要(任意)'), { target: { value: '家賃 10月分' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ memo: '家賃 10月分' }))
  })

  it('readOnlyLines でも各行の2段目(取引先・プロジェクト・世帯メンバー)を、読み取り専用で表示する', () => {
    render(<Harness initial={value([debit(1, 1, '1000'), credit(2, 2, '1000')])} readOnlyLines />)

    const debitColumn = within(screen.getByRole('group', { name: '借方' }))
    const creditColumn = within(screen.getByRole('group', { name: '貸方' }))
    expect(debitColumn.getByRole('button', { name: /^取引先/ })).toBeDisabled()
    expect(debitColumn.getByRole('button', { name: /^プロジェクト/ })).toBeDisabled()
    expect(debitColumn.getByRole('combobox', { name: '世帯メンバー' })).toBeDisabled()
    expect(creditColumn.getByRole('button', { name: /^プロジェクト/ })).toBeDisabled()
    // 費用・収益ではない科目の行には、取引先は出ない
    expect(creditColumn.queryByRole('button', { name: /^取引先/ })).not.toBeInTheDocument()
  })
})
