// @vitest-environment jsdom
/**
 * 明細行単位の表(JournalLineTable)のインライン編集(計画Issue #182)のコンポーネントテスト。
 * 編集中の仕訳だけが入力欄になり他の仕訳は閲覧のままであること、摘要・コメント・取引日・金額・世帯メンバーの編集、
 * 取引先と精算バッチが科目に応じてどちらか一方だけ「取引先・精算バッチ」の列に出ること、
 * 「+ 借方の行」「+ 貸方の行」と行の削除、借方合計・貸方合計と貸借の一致状況の表示、貸借が合わない間と
 * 保存中は保存できないこと、キャンセル(ボタンと Esc キー)、仕訳の削除(2回押して確定する確認の表示)を検証する。
 * 外部依存なし(編集内容は親が持つ値として Harness の state で模す。保存・削除の実処理は親の責務)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { fromJournalLine } from './journalEntryFormLine'
import type { JournalEditorMaster, JournalEditorValue } from './JournalEntryEditor'
import { JournalLineTable, type JournalLineTableLookup, type JournalLineTableProps } from './JournalLineTable'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

const accounts = [account(1, '食費', 'expense'), account(2, '普通預金', 'asset'), account(3, '立替金', 'asset', { isSystemManaged: true })]

const master: JournalEditorMaster = {
  accounts,
  accountCategories: [
    { key: 'expense', name: '費用', nodes: [{ kind: 'item', value: '1', name: '食費', isActive: true }] },
    {
      key: 'asset',
      name: '資産',
      nodes: [
        { kind: 'item', value: '2', name: '普通預金', isActive: true },
        { kind: 'item', value: '3', name: '立替金', isActive: true },
      ],
    },
  ],
  counterpartyCategories: [],
  projectCategories: [],
  members: [
    { id: 1, name: '太郎', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
    { id: 2, name: '花子', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
  ],
  batches: [{ id: 30, name: '11月の割勘', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }],
}

const lookup: JournalLineTableLookup = {
  accountName: (id) => accounts.find((a) => a.id === id)?.name ?? '',
  projectName: () => '',
  counterpartyName: () => '',
  batchName: (id) => (id === 30 ? '11月の割勘' : ''),
  memberName: (id) => master.members.find((m) => m.id === id)?.name ?? '',
}

function line(id: number, entryId: number, side: 'debit' | 'credit', accountId: number, amount: number): JournalLine {
  return {
    id,
    journalEntryId: entryId,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
  }
}

function entry(id: number, memo: string, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-11-10',
    memo,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '',
    updatedAt: '',
    lines,
  }
}

const target = entry(1, 'コンビニ', [line(11, 1, 'debit', 1, 1280), line(12, 1, 'credit', 2, 1280)])
const other = entry(2, '家賃', [line(21, 2, 'debit', 1, 80000), line(22, 2, 'credit', 2, 80000)])

function valueOf(e: JournalEntry): JournalEditorValue {
  return {
    entryDate: e.entryDate,
    memo: e.memo ?? '',
    comment: e.comment ?? '',
    householdMemberId: e.householdMemberId,
    lines: e.lines.map((l, i) => ({ key: i + 1, line: fromJournalLine(l) })),
  }
}

interface HarnessOptions {
  initial?: JournalEditorValue
  busy?: boolean
  deleteArmed?: boolean
  onSave?: () => void
  onCancel?: () => void
  onDelete?: () => void
  onDeleteCancel?: () => void
  onValue?: (value: JournalEditorValue) => void
  props?: Partial<JournalLineTableProps>
}

function Harness({ initial = valueOf(target), busy = false, deleteArmed = false, onSave, onCancel, onDelete, onDeleteCancel, onValue, props }: HarnessOptions) {
  const [value, setValue] = useState(initial)
  return (
    <JournalLineTable
      entries={[target, other]}
      lookup={lookup}
      selectedId={1}
      onSelect={vi.fn()}
      editing={{
        entryId: 1,
        value,
        onChange: (next) => {
          setValue(next)
          onValue?.(next)
        },
        master,
        busy,
        onSave: onSave ?? vi.fn(),
        onCancel: onCancel ?? vi.fn(),
        onDelete: onDelete ?? vi.fn(),
        onDeleteCancel: onDeleteCancel ?? vi.fn(),
        deleteArmed,
      }}
      {...props}
    />
  )
}

/** 1つの仕訳の明細行(tbody の tr)。編集中に下へ出る操作バーの行は数えない */
function rowsOf(container: HTMLElement, entryId: number): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`tbody[data-entry-id="${entryId}"] tr:not(.journal-line-table__bar)`))
}

const yen = (n: number) => formatCurrency(n, 'JPY')

describe('JournalLineTable(インライン編集)', () => {
  it('編集中の仕訳だけが入力欄になる。他の仕訳は閲覧のままで、摘要は押せるボタンとして出る', () => {
    render(<Harness />)
    expect(screen.getByLabelText('摘要')).toHaveValue('コンビニ')
    expect(screen.getByLabelText('コメント')).toHaveValue('')
    expect(screen.getByLabelText('取引日')).toHaveValue('2026-11-10')
    expect(screen.getAllByLabelText('摘要')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'コンビニ' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '家賃' })).toBeInTheDocument()
  })

  it('食費など費用の科目の行には取引先の選択、立替金(システム管理)の行には精算バッチの選択が、どちらか一方だけ出る', () => {
    const advance = entry(1, '立替', [line(11, 1, 'debit', 3, 3200), line(12, 1, 'credit', 1, 3200)])
    render(<Harness initial={valueOf(advance)} />)
    // 借方=立替金 → 精算バッチだけ。貸方=食費(費用) → 取引先だけ
    expect(screen.getByLabelText('借方の精算バッチ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /借方の取引先/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /貸方の取引先/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('貸方の精算バッチ')).not.toBeInTheDocument()
  })

  it('取引先も精算バッチも持てない科目(普通預金)の行には、どちらの選択も出ない', () => {
    render(<Harness />)
    // 貸方=普通預金(資産・システム管理でない)
    expect(screen.queryByRole('button', { name: /貸方の取引先/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('貸方の精算バッチ')).not.toBeInTheDocument()
  })

  it('摘要・コメントを書き換えると、編集内容の onChange に反映される', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'コンビニ(朝)' } })
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ memo: 'コンビニ(朝)' }))
    fireEvent.change(screen.getByLabelText('コメント'), { target: { value: '朝食' } })
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ comment: '朝食' }))
  })

  it('借方・貸方の金額欄を書き換えると、その行の金額が更新される', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.change(screen.getByLabelText('借方の金額'), { target: { value: '1500' } })
    const lines = onValue.mock.calls.at(-1)![0].lines
    expect(lines[0].line.amountInput).toBe('1500')
    expect(lines[1].line.amountInput).toBe('1280')
  })

  it('世帯メンバーを選び直すと、その行の世帯メンバーが更新される', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.change(screen.getByLabelText('貸方の世帯メンバー'), { target: { value: '2' } })
    expect(onValue.mock.calls.at(-1)![0].lines[1].line.householdMemberId).toBe(2)
  })

  it('科目の選択ボタンが借方・貸方の行に出て、いまの科目名を表示する', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: '借方の科目: 食費' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '貸方の科目: 普通預金' })).toBeInTheDocument()
  })

  it('「+ 借方の行」で、起票者を世帯メンバーの既定値にした空の借方の行が増え、表に1行足される', () => {
    const onValue = vi.fn()
    const { container } = render(<Harness onValue={onValue} />)
    expect(rowsOf(container, 1)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '+ 借方の行' }))
    const added = onValue.mock.calls.at(-1)![0].lines.at(-1).line
    expect(added).toMatchObject({ side: 'debit', accountId: null, amountInput: '', householdMemberId: 1 })
    expect(rowsOf(container, 1)).toHaveLength(2)
  })

  it('「+ 貸方の行」で、空の貸方の行が増える', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.click(screen.getByRole('button', { name: '+ 貸方の行' }))
    expect(onValue.mock.calls.at(-1)![0].lines.at(-1).line).toMatchObject({ side: 'credit', accountId: null })
  })

  it('片側が2行以上のとき、行の「×」でその行を削除できる。1行だけの側は削除できない', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    expect(screen.getByRole('button', { name: '借方の行を削除' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '+ 借方の行' }))
    const deleteButtons = screen.getAllByRole('button', { name: '借方の行を削除' })
    expect(deleteButtons).toHaveLength(2)
    fireEvent.click(deleteButtons[1])
    expect(onValue.mock.calls.at(-1)![0].lines).toHaveLength(2)
  })

  it('借方合計・貸方合計と、貸借が一致している旨を表示する', () => {
    render(<Harness />)
    expect(screen.getByText(`借方合計 ${yen(1280)}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(`貸方合計 ${yen(1280)}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('貸借が一致しています')
  })

  it('貸借の一致状況は、貸方合計の左隣(貸方の列の同じ行)に出る。保存などのボタンとは別の行', () => {
    render(<Harness />)
    const status = screen.getByRole('status')
    const creditTotal = screen.getByText(`貸方合計 ${yen(1280)}`, { exact: false })
    // 貸方の列(境目の縦線のクラスが付いたセル)の中で、貸方合計と同じセル・同じ行にあり、貸方合計より前(左)にある
    expect(status.closest('td')).toHaveClass('journal-line-table__credit-start')
    expect(status.closest('td')).toBe(creditTotal.closest('td'))
    expect(creditTotal.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(status.closest('tr')).not.toBe(screen.getByRole('button', { name: '保存' }).closest('tr'))
  })

  it('編集中の仕訳には出どころのタグを出さない(他の仕訳には出る)', () => {
    const { container } = render(<Harness />)
    expect(within(rowsOf(container, 1)[0]).queryByText('手入力')).not.toBeInTheDocument()
    expect(within(rowsOf(container, 2)[0]).getByText('手入力')).toBeInTheDocument()
  })

  it('出どころのタグの分、取引日と摘要の入力欄は同じ広いセルに並ぶ(出どころの列に食い込む)', () => {
    render(<Harness />)
    const cell = screen.getByLabelText('取引日').closest('td') as HTMLElement
    expect(cell).toBe(screen.getByLabelText('摘要').closest('td'))
    // 日付(1列)+出どころ(1列)+摘要(1列)の3列分
    expect(cell).toHaveAttribute('colspan', '3')
  })

  it('金額を変えて貸借が合わなくなると、差額を表示し、保存が押せなくなる', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('借方の金額'), { target: { value: '1500' } })
    expect(screen.getByRole('status')).toHaveTextContent(`貸借が合っていません(差額 ${yen(220)})`)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('貸借が合っていれば保存でき、押すと onSave が呼ばれる', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('保存中(busy)は、貸借が合っていても保存が押せない', () => {
    render(<Harness busy />)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('「キャンセル」を押すと onCancel が呼ばれる', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('編集中の入力欄で Esc キーを押すと、キャンセルになる(onCancel)', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('摘要'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('選択ツリーが開いているときの Esc は、ツリーを閉じるだけで編集はキャンセルしない', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /^借方の科目/ }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: '借方の科目' }), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('保存中(busy)は Esc でキャンセルしない', () => {
    const onCancel = vi.fn()
    render(<Harness busy onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('摘要'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('「仕訳を削除」を押すと onDelete が呼ばれる(2回押しの確定は親が持つ)', () => {
    const onDelete = vi.fn()
    render(<Harness onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: '仕訳を削除' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('削除の確認中(deleteArmed)は、元に戻せない旨と「本当に削除する」「やめる」を表示する', () => {
    const onDelete = vi.fn()
    const onDeleteCancel = vi.fn()
    render(<Harness deleteArmed onDelete={onDelete} onDeleteCancel={onDeleteCancel} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('この仕訳を削除します。元に戻せません。')
    fireEvent.click(within(alert).getByRole('button', { name: 'やめる' }))
    expect(onDeleteCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(within(alert).getByRole('button', { name: '本当に削除する' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('複合仕訳を編集するときは、借方・貸方を行番号で対応づけた行ごとに入力欄が並ぶ', () => {
    const compound = entry(1, '給与', [
      line(1, 1, 'debit', 2, 245300),
      line(2, 1, 'debit', 1, 54700),
      line(3, 1, 'credit', 2, 300000),
    ])
    const { container } = render(<Harness initial={valueOf(compound)} />)
    const rows = rowsOf(container, 1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByLabelText('貸方の金額')).toHaveValue('300000')
    expect(within(rows[1]).queryByLabelText('貸方の金額')).not.toBeInTheDocument()
    expect(within(rows[1]).getByLabelText('借方の金額')).toHaveValue('54700')
  })
})
