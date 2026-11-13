// @vitest-environment jsdom
/**
 * 一括編集バー(JournalLineBulkBar、計画Issue #182)のコンポーネントテスト。
 * 選択件数(行・借方・貸方・仕訳)と「選択を解除」、変える項目(科目・プロジェクト・取引先・精算バッチ・
 * 世帯メンバー)の選択、選べない項目の先回りの無効化と理由の表示(取引先は費用・収益の科目だけ、精算バッチは
 * 立替金・未払金だけ、世帯メンバーは既定メンバーのない科目だけ。科目を一括で変えるときは変更後の科目で判断)、
 * 選べなくなった項目の選択が外れること、外れる値の警告(確認時のみ)、「適用」の2回押しの確認を検証する。
 * 外部依存なし(選択した行と編集内容(pick)は親が持つ値として Harness の state で模す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import type { JournalEditorMaster } from './JournalEntryEditor'
import { EMPTY_BULK_PICK, type BulkPick, type BulkSelectedLine } from './journalBulkEditModel'
import { JournalLineBulkBar } from './JournalLineBulkBar'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return { id, category, name, isReconcilable: null, hasExternalStatement: null, isActive: true, isSystemManaged: false, householdMemberId: null, accountGroupId: null, sortOrder: id, createdAt: '', updatedAt: '', ...extra }
}

const accounts = [
  account(1, '食費', 'expense'),
  account(3, '普通預金', 'asset'),
  account(4, '立替金', 'asset', { isSystemManaged: true }),
  account(5, '携帯代(妻)', 'expense', { householdMemberId: 2 }),
]

const master: JournalEditorMaster = {
  accounts,
  accountCategories: [
    {
      key: 'expense',
      name: '費用',
      nodes: [
        { kind: 'item', value: '1', name: '食費', isActive: true },
        { kind: 'item', value: '5', name: '携帯代(妻)', isActive: true },
      ],
    },
    {
      key: 'asset',
      name: '資産',
      nodes: [
        { kind: 'item', value: '3', name: '普通預金', isActive: true },
        { kind: 'item', value: '4', name: '立替金', isActive: true },
      ],
    },
  ],
  projectCategories: [{ key: 'project', name: 'プロジェクト', nodes: [{ kind: 'item', value: '30', name: '自宅', isActive: true }] }],
  counterpartyCategories: [{ key: 'cp', name: '取引先', nodes: [{ kind: 'item', value: '8', name: 'セブンイレブン', isActive: true }] }],
  members: [
    { id: 1, name: '夫', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
    { id: 2, name: '妻', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
  ],
  batches: [{ id: 7, name: '6月の割勘', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }],
}

function line(id: number, entryId: number, side: 'debit' | 'credit', accountId: number, amount: number, extra: Partial<JournalLine> = {}): JournalLine {
  return { id, journalEntryId: entryId, accountId, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side, amount, createdAt: '', ...extra }
}

function entry(id: number, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-11-10',
    memo: `仕訳${id}`,
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

// 仕訳1: 食費(借)1000(取引先8) / 普通預金(貸)1000 ・ 仕訳2: 立替金(借)500(精算バッチ7) / 食費(貸)500
const e1 = entry(1, [line(11, 1, 'debit', 1, 1000, { counterpartyId: 8 }), line(12, 1, 'credit', 3, 1000)])
const e2 = entry(2, [line(21, 2, 'debit', 4, 500, { settlementBatchId: 7 }), line(22, 2, 'credit', 1, 500)])

const sel = (e: JournalEntry, lineId: number): BulkSelectedLine => ({ entry: e, line: e.lines.find((l) => l.id === lineId) as JournalLine })

interface HarnessProps {
  selected: BulkSelectedLine[]
  initialPick?: BulkPick
  initialConfirming?: boolean
  busy?: boolean
  onApply?: () => void
  onClearSelection?: () => void
  onAskConfirm?: () => void
  onCancelConfirm?: () => void
  onPick?: (pick: BulkPick) => void
}

function Harness({ selected, initialPick = EMPTY_BULK_PICK, initialConfirming = false, busy = false, onApply, onClearSelection, onAskConfirm, onCancelConfirm, onPick }: HarnessProps) {
  const [pick, setPick] = useState(initialPick)
  const [confirming, setConfirming] = useState(initialConfirming)
  return (
    <JournalLineBulkBar
      selected={selected}
      pick={pick}
      onPickChange={(next) => {
        setPick(next)
        setConfirming(false)
        onPick?.(next)
      }}
      master={master}
      confirming={confirming}
      onAskConfirm={() => {
        setConfirming(true)
        onAskConfirm?.()
      }}
      onCancelConfirm={() => {
        setConfirming(false)
        onCancelConfirm?.()
      }}
      onApply={onApply ?? vi.fn()}
      onClearSelection={onClearSelection ?? vi.fn()}
      busy={busy}
    />
  )
}

/** 選択ツリー(科目・プロジェクト・取引先)で項目を選ぶ。ボタンの名前は「<項目>: <いまの値>」 */
function chooseTree(label: string, current: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: `${label}: ${current}` }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: option }))
}

const applyButton = () => screen.getByRole('button', { name: /に適用$|^適用$/ })

describe('JournalLineBulkBar', () => {
  it('選択件数(行・借方の行・貸方の行・仕訳の件数)を表示し、「選択を解除」で onClearSelection が呼ばれる', () => {
    const onClearSelection = vi.fn()
    render(<Harness selected={[sel(e1, 11), sel(e1, 12), sel(e2, 21)]} onClearSelection={onClearSelection} />)
    expect(screen.getByText('3行を選択中(借方 2行・貸方 1行、2件の仕訳)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('初期はすべて「変更しない」で、適用は押せない。変える項目を選ぶよう促す', () => {
    render(<Harness selected={[sel(e1, 11)]} />)
    expect(applyButton()).toBeDisabled()
    expect(screen.queryByText(/ここに変更の内容が出ます/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括編集の科目: 変更しない' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括編集のプロジェクト: 変更しない' })).toBeInTheDocument()
  })

  describe('項目の選択', () => {
    it('科目を選ぶと pick に反映され、「N行に適用」が出る(変更内容の一覧は出さない)', () => {
      const onPick = vi.fn()
      render(<Harness selected={[sel(e1, 11), sel(e1, 12)]} onPick={onPick} />)
      chooseTree('一括編集の科目', '変更しない', '食費')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 1 }))
      expect(screen.queryByText(/科目 → 食費/)).not.toBeInTheDocument()
      expect(applyButton()).toHaveTextContent('2行に適用')
      expect(applyButton()).toBeEnabled()
    })

    it('プロジェクトは「なし(外す)」も選べる。「変更しない」に戻すこともできる', () => {
      const onPick = vi.fn()
      render(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      chooseTree('一括編集のプロジェクト', '変更しない', '自宅')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'set', value: 30 } }))
      chooseTree('一括編集のプロジェクト', '自宅', 'なし(外す)')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'clear' } }))
      chooseTree('一括編集のプロジェクト', 'なし(外す)', '変更しない')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'keep' } }))
    })

    it('世帯メンバーを選ぶと pick に反映される', () => {
      const onPick = vi.fn()
      render(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      fireEvent.change(screen.getByLabelText('一括編集の世帯メンバー'), { target: { value: '2' } })
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ memberId: 2 }))
    })
  })

  describe('選べない項目の先回りの無効化', () => {
    it('費用の行だけを選んでいれば、取引先を選べる(理由は出ない)', () => {
      const onPick = vi.fn()
      render(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeEnabled()
      chooseTree('一括編集の取引先', '変更しない', 'セブンイレブン')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ counterparty: { kind: 'set', value: 8 } }))
      expect(screen.queryByText('費用・収益の行のみ')).not.toBeInTheDocument()
    })

    it('資産の科目(普通預金)の行が混ざると、取引先は選べず、短い理由を出す', () => {
      render(<Harness selected={[sel(e1, 11), sel(e1, 12)]} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      expect(screen.getByText('費用・収益の行のみ')).toBeInTheDocument()
    })

    it('立替金の行だけなら精算バッチを選べる。食費の行が混ざると選べず、理由を出す', () => {
      const { unmount } = render(<Harness selected={[sel(e2, 21)]} />)
      expect(screen.getByLabelText('一括編集の精算バッチ')).toBeEnabled()
      unmount()
      render(<Harness selected={[sel(e2, 21), sel(e2, 22)]} />)
      expect(screen.getByLabelText('一括編集の精算バッチ')).toBeDisabled()
      expect(screen.getByText('立替金・未払金の行のみ')).toBeInTheDocument()
    })

    it('既定の世帯メンバーがある科目に変えようとしているとき、世帯メンバーは選べない', () => {
      render(<Harness selected={[sel(e1, 11)]} initialPick={{ ...EMPTY_BULK_PICK, accountId: 5 }} />)
      expect(screen.getByLabelText('一括編集の世帯メンバー')).toBeDisabled()
      expect(screen.getByText('既定メンバーのある科目は不可')).toBeInTheDocument()
    })

    it('科目を費用の科目に一括で変えようとすると、資産の行が混ざっていても取引先を選べるようになる', () => {
      render(<Harness selected={[sel(e1, 12)]} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      chooseTree('一括編集の科目', '変更しない', '食費')
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeEnabled()
    })

    it('科目を立替金に一括で変えようとすると、食費の行が混ざっていても精算バッチを選べるようになる', () => {
      render(<Harness selected={[sel(e1, 11)]} />)
      expect(screen.getByLabelText('一括編集の精算バッチ')).toBeDisabled()
      chooseTree('一括編集の科目', '変更しない', '立替金')
      expect(screen.getByLabelText('一括編集の精算バッチ')).toBeEnabled()
    })

    it('選べなくなった項目の選択は外れる(取引先を選んだあと、科目を普通預金に変えると、取引先は「変更しない」に戻る)', () => {
      const onPick = vi.fn()
      render(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      chooseTree('一括編集の取引先', '変更しない', 'セブンイレブン')
      chooseTree('一括編集の科目', '変更しない', '普通預金')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 3, counterparty: { kind: 'keep' } }))
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
    })

    it('0行のとき(選択が空になった直後など)も、すべての項目が選べない', () => {
      render(<Harness selected={[]} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      expect(screen.getByLabelText('一括編集の精算バッチ')).toBeDisabled()
      expect(screen.getByLabelText('一括編集の世帯メンバー')).toBeDisabled()
    })
  })

  it('科目を変えて取引先・精算バッチが外れる行があるときは、確認の中でだけその旨を出す(確認前は出さない)', () => {
    const pick = { ...EMPTY_BULK_PICK, accountId: 3 }
    const { unmount } = render(<Harness selected={[sel(e1, 11)]} initialPick={pick} />)
    expect(screen.queryByText(/取引先が外れます/)).not.toBeInTheDocument()
    unmount()
    render(<Harness selected={[sel(e1, 11)]} initialPick={pick} initialConfirming />)
    expect(within(screen.getByRole('alert')).getByText(/取引先が付いている1行は、取引先が外れます/)).toBeInTheDocument()
  })

  describe('適用の2回押しの確認', () => {
    const picked: BulkPick = { ...EMPTY_BULK_PICK, project: { kind: 'set', value: 30 } }

    it('1回目の「N行に適用」では適用せず、確認を求める(onAskConfirm)', () => {
      const onApply = vi.fn()
      const onAskConfirm = vi.fn()
      render(<Harness selected={[sel(e1, 11), sel(e2, 21)]} initialPick={picked} onApply={onApply} onAskConfirm={onAskConfirm} />)
      fireEvent.click(applyButton())
      expect(onAskConfirm).toHaveBeenCalledTimes(1)
      expect(onApply).not.toHaveBeenCalled()
    })

    it('確認中は、更新する行数と元に戻せない旨を出し、「やめる」で確認を取り消せる', () => {
      const onCancelConfirm = vi.fn()
      render(<Harness selected={[sel(e1, 11), sel(e2, 21)]} initialPick={picked} initialConfirming onCancelConfirm={onCancelConfirm} />)
      expect(screen.getByRole('alert')).toHaveTextContent('2行(2件の仕訳)を更新します。元に戻せません。')
      fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
      expect(onCancelConfirm).toHaveBeenCalledTimes(1)
    })

    it('確認中の「本当に更新する」で、初めて onApply が呼ばれる', () => {
      const onApply = vi.fn()
      render(<Harness selected={[sel(e1, 11)]} initialPick={picked} initialConfirming onApply={onApply} />)
      fireEvent.click(screen.getByRole('button', { name: '本当に更新する' }))
      expect(onApply).toHaveBeenCalledTimes(1)
    })

    it('項目を選び直すと、確認は取り消される(確認の表示が消え、「N行に適用」に戻る)', () => {
      render(<Harness selected={[sel(e1, 11)]} initialPick={picked} initialConfirming />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('一括編集の世帯メンバー'), { target: { value: '2' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(applyButton()).toBeInTheDocument()
    })

    it('保存中(busy)は、「N行に適用」も「本当に更新する」も押せない', () => {
      const { unmount } = render(<Harness selected={[sel(e1, 11)]} initialPick={picked} busy />)
      expect(applyButton()).toBeDisabled()
      unmount()
      render(<Harness selected={[sel(e1, 11)]} initialPick={picked} initialConfirming busy />)
      expect(screen.getByRole('button', { name: '本当に更新する' })).toBeDisabled()
    })
  })
})
