// @vitest-environment jsdom
/**
 * 行編集の共通部品(JournalLinesEditor、計画Issue #180)のコンポーネントテスト。仕訳の起票・編集、定期仕訳の
 * ルールの作成・編集、承認待ちの定期仕訳の確認パネルが共有する、借方・貸方の2列の行編集を検証する:
 * 列ごとの合計と貸借一致/差額の表示、行の追加・削除、読み取り専用(readOnlyLines)のときは科目と行の
 * 追加・削除が編集できず金額だけ編集できること、起票者が未決定(null)でも行を追加できること(定期仕訳のルール)、
 * 科目の区分に応じて取引先・精算バッチの欄が出ること。外部依存なし(マスタは props で渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEditorLine, JournalEditorMaster } from './JournalEntryEditor'
import { chooseBatch, expectBatch, findBatchButton, queryBatchButton } from '../master/batchSelectTestHelpers'
import { JournalLinesEditor, type JournalLinesEditorProps } from './JournalLinesEditor'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return {
    id,
    category,
    name,
    isReconcilable: category === 'expense' ? null : false,
    hasExternalStatement: category === 'expense' ? null : false,
    isActive: true,
    isSystemManaged: false,
    autoBalanceAdjustment: true,
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
  batches: [{ id: 1, name: '6月の割勘', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }],
}

const line = (key: number, side: 'debit' | 'credit', accountId: number | null, amount: string): JournalEditorLine => ({
  key,
  line: { accountId, side, amountInput: amount, projectId: null, householdMemberId: 1, counterpartyId: null },
})

function Harness(props: {
  initial: JournalEditorLine[]
  readOnlyLines?: boolean
  bookkeeperId?: number | null
  allowBlankAmounts?: boolean
  onRequestCreateProject?: (apply: (id: number) => void) => void
  onCreateBatch?: JournalLinesEditorProps['onCreateBatch']
  onLinesChange?: (lines: JournalEditorLine[]) => void
}) {
  const [lines, setLines] = useState(props.initial)
  return (
    <JournalLinesEditor
      lines={lines}
      onChange={(next) => {
        setLines(next)
        props.onLinesChange?.(next)
      }}
      master={master}
      bookkeeperId={props.bookkeeperId === undefined ? 1 : props.bookkeeperId}
      readOnlyLines={props.readOnlyLines}
      allowBlankAmounts={props.allowBlankAmounts}
      onRequestCreateProject={props.onRequestCreateProject}
      onCreateBatch={props.onCreateBatch}
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

    expect(findBatchButton('精算バッチ', within(screen.getByRole('group', { name: '貸方' })))).toBeInTheDocument()
    expect(queryBatchButton('精算バッチ', within(screen.getByRole('group', { name: '借方' })))).toBeNull()
  })

  it('onRequestCreateProject を渡すと、プロジェクトの選択ツリーに「+ 新規追加」が出て、押すと呼ばれる(計画Issue #180)', () => {
    const onRequestCreateProject = vi.fn()
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} onRequestCreateProject={onRequestCreateProject} />)

    fireEvent.click(within(screen.getByRole('group', { name: '借方' })).getByRole('button', { name: /^プロジェクト/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクト' })).getByRole('button', { name: /新規追加/ }))

    expect(onRequestCreateProject).toHaveBeenCalledTimes(1)
  })

  it('onRequestCreateProject を渡さないときは、「+ 新規追加」は出ない', () => {
    render(<Harness initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 2, '1200')]} />)

    fireEvent.click(within(screen.getByRole('group', { name: '借方' })).getByRole('button', { name: /^プロジェクト/ }))

    expect(within(screen.getByRole('dialog', { name: 'プロジェクト' })).queryByRole('button', { name: /新規追加/ })).toBeNull()
  })

  it('onCreateBatch を渡すと、精算バッチの選択肢に「+ 新しいバッチ」が出る', () => {
    render(
      <Harness
        initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 3, '1200')]}
        onCreateBatch={async (name) => ({ id: 1, name, type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' })}
      />,
    )

    fireEvent.click(findBatchButton('精算バッチ'))
    expect(screen.getByRole('button', { name: '+ 新しいバッチ' })).toBeInTheDocument()
  })

  it('精算バッチを選ぶと、その行のバッチが更新され、「精算バッチなし」で外せる', () => {
    const onLinesChange = vi.fn()
    render(<Harness onLinesChange={onLinesChange} initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 3, '1200')]} />)

    chooseBatch('精算バッチ', '6月の割勘')
    expect(onLinesChange.mock.calls.at(-1)![0][1].line.settlementBatchId).toBe(1)
    expectBatch('精算バッチ', '6月の割勘')

    chooseBatch('精算バッチ', '精算バッチなし')
    expect(onLinesChange.mock.calls.at(-1)![0][1].line.settlementBatchId).toBeNull()
  })

  it('「+ 新しいバッチ」を押すと名前の入力欄が開き、作成すると、その行のバッチになる', async () => {
    const onLinesChange = vi.fn()
    render(
      <Harness
        onLinesChange={onLinesChange}
        initial={[line(1, 'debit', 1, '1200'), line(2, 'credit', 3, '1200')]}
        onCreateBatch={async (name) => ({ id: 9, name, type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' })}
      />,
    )

    fireEvent.click(findBatchButton('精算バッチ'))
    fireEvent.click(screen.getByRole('button', { name: '+ 新しいバッチ' }))
    fireEvent.change(screen.getByLabelText('新しい精算バッチの名前'), { target: { value: '旅行' } })
    fireEvent.click(screen.getByRole('button', { name: 'バッチを作成' }))

    await waitFor(() => expect(onLinesChange.mock.calls.at(-1)![0][1].line.settlementBatchId).toBe(9))
    expect(screen.queryByLabelText('新しい精算バッチの名前')).toBeNull()
  })
})

describe('JournalLinesEditor: 金額の空欄を許すモード(allowBlankAmounts、仕訳テンプレート、計画Issue #201)', () => {
  it('全行が空欄のとき、列の見出しは「空欄(起票時に入力)」で、貸借の表示は出さない', () => {
    render(<Harness allowBlankAmounts initial={[line(1, 'debit', 1, ''), line(2, 'credit', 2, '')]} />)

    expect(within(screen.getByRole('group', { name: '借方' })).getByText('空欄(起票時に入力)')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '貸方' })).getByText('空欄(起票時に入力)')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('金額が空欄の行は、起票時に入力します')
    expect(screen.getByRole('status')).not.toHaveClass('journal-editor__balance--off')
  })

  it('一部の行だけ空欄のとき、金額のある列は合計を出し、貸借の不一致は警告せず空欄の案内を出す', () => {
    render(<Harness allowBlankAmounts initial={[line(1, 'debit', 1, '500'), line(2, 'credit', 2, '')]} />)

    expect(within(screen.getByRole('group', { name: '借方' })).getByText('￥500')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '貸方' })).getByText('空欄(起票時に入力)')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('金額が空欄の行は、起票時に入力します')
    expect(screen.getByRole('status')).not.toHaveClass('journal-editor__balance--off')
  })

  it('全行の金額が入っているときは、通常どおり貸借一致/差額を出す', () => {
    render(<Harness allowBlankAmounts initial={[line(1, 'debit', 1, '500'), line(2, 'credit', 2, '500')]} />)
    expect(screen.getByRole('status')).toHaveTextContent('貸借一致')
    cleanup()
    render(<Harness allowBlankAmounts initial={[line(1, 'debit', 1, '500'), line(2, 'credit', 2, '400')]} />)
    expect(screen.getByRole('status')).toHaveTextContent('差額 ￥100')
  })

  it('指定しない通常のモードでは、空欄でも従来どおり「差額」の表示になる', () => {
    render(<Harness initial={[line(1, 'debit', 1, ''), line(2, 'credit', 2, '')]} />)

    expect(within(screen.getByRole('group', { name: '借方' })).queryByText('空欄(起票時に入力)')).toBeNull()
  })
})
