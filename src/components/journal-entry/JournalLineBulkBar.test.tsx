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
import { chooseMember, findMemberButton } from '../master/memberSelectTestHelpers'
import { chooseBatch, findBatchButton } from '../master/batchSelectTestHelpers'
import { JournalLineBulkBar } from './JournalLineBulkBar'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return { id, category, name, isReconcilable: null, hasExternalStatement: null, isActive: true, isSystemManaged: false, autoBalanceAdjustment: true, householdMemberId: null, accountGroupId: null, sortOrder: id, createdAt: '', updatedAt: '', ...extra }
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
  batches: [{ id: 7, name: '6月の割勘', type: 'expense_splitting', counterpartyId: null, isActive: true, createdAt: '', updatedAt: '' }],
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
  masterOverride?: JournalEditorMaster
  onRequestCreateAccount?: (apply: (id: number) => void) => void
  onRequestCreateProject?: (apply: (id: number) => void) => void
  onRequestCreateCounterparty?: (apply: (id: number) => void) => void
}

function Harness({ selected, initialPick = EMPTY_BULK_PICK, initialConfirming = false, busy = false, onApply, onClearSelection, onAskConfirm, onCancelConfirm, onPick, masterOverride, onRequestCreateAccount, onRequestCreateProject, onRequestCreateCounterparty }: HarnessProps) {
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
      master={masterOverride ?? master}
      onRequestCreateAccount={onRequestCreateAccount}
      onRequestCreateProject={onRequestCreateProject}
      onRequestCreateCounterparty={onRequestCreateCounterparty}
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

/** バーを描く(5項目は常に出ているので、開く操作は要らない。計画Issue #280) */
function renderBar(ui: React.ReactElement) {
  return render(ui)
}

/** 確認は、固定バーを高くしないよう、ダイアログで出す */
const confirmDialog = () => screen.getByRole('dialog', { name: '一括編集の確認' })

/** 選択欄(ラベル付きの項目)を囲む要素。無効の理由がこの中に出ることを確かめるために使う */
const fieldOf = (label: string) => screen.getByText(label, { selector: '.journal-line-bulk__label' }).closest('.journal-line-bulk__field') as HTMLElement

describe('JournalLineBulkBar: 2段構成(計画Issue #280)', () => {
  it('5項目(科目・プロジェクト・取引先・精算バッチ・世帯メンバー)が、初めからラベル付きで出ている', () => {
    render(<Harness selected={[sel(e1, 11)]} />)
    for (const label of ['科目', 'プロジェクト', '取引先', '精算バッチ', '世帯メンバー']) {
      expect(screen.getByText(label, { selector: '.journal-line-bulk__label' })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: '一括編集の科目: 変更しない' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括編集のプロジェクト: 変更しない' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeInTheDocument()
    expect(findBatchButton('一括編集の精算バッチ')).toBeInTheDocument()
    expect(findMemberButton('一括編集の世帯メンバー')).toBeInTheDocument()
  })

  it('「その他の項目」の開閉ボタンは無い', () => {
    render(<Harness selected={[sel(e1, 11)]} />)
    expect(screen.queryByRole('button', { name: /その他の項目/ })).not.toBeInTheDocument()
  })

  it('案内文は、Esc での解除の説明まで全文が出ている', () => {
    render(<Harness selected={[sel(e1, 11)]} />)
    expect(screen.getByText(/選択中は、行を押してもチェックを切り替えられます。Esc でも解除できます。/)).toBeInTheDocument()
  })

  it('無効な項目の理由は、その項目の欄の中に出る(欄の外にはみ出さない)', () => {
    render(<Harness selected={[sel(e1, 11), sel(e1, 12)]} />)
    expect(within(fieldOf('取引先')).getByText('費用・収益の行のみ')).toBeInTheDocument()
    expect(within(fieldOf('精算バッチ')).getByText('未収金・未払金(精算バッチ)の行のみ')).toBeInTheDocument()
  })

  it('理由の欄は、理由が無いときも場所を空けておく(理由の有無で2段目の高さが変わらない)', () => {
    render(<Harness selected={[sel(e1, 11)]} />)
    expect(fieldOf('取引先').querySelector('.journal-line-bulk__why')).not.toBeNull()
    expect(fieldOf('プロジェクト').querySelector('.journal-line-bulk__why')).not.toBeNull()
  })

  it('確認はバーの中ではなくダイアログで出る(バーの高さが増えない)', () => {
    render(<Harness selected={[sel(e1, 11)]} initialPick={{ ...EMPTY_BULK_PICK, project: { kind: 'set', value: 30 } }} initialConfirming />)
    expect(within(screen.getByRole('region', { name: '一括編集' })).queryByText(/元に戻せません/)).not.toBeInTheDocument()
    expect(confirmDialog()).toHaveTextContent('1行(1件の仕訳)を更新します。元に戻せません。')
  })
})

describe('JournalLineBulkBar', () => {
  it('選択件数(行・借方の行・貸方の行・仕訳の件数)を表示し、「選択を解除」で onClearSelection が呼ばれる', () => {
    const onClearSelection = vi.fn()
    renderBar(<Harness selected={[sel(e1, 11), sel(e1, 12), sel(e2, 21)]} onClearSelection={onClearSelection} />)
    expect(screen.getByText('3行を選択中(借方 2行・貸方 1行、2件の仕訳)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('初期はすべて「変更しない」で、適用は押せない。変える項目を選ぶよう促す', () => {
    renderBar(<Harness selected={[sel(e1, 11)]} />)
    expect(applyButton()).toBeDisabled()
    expect(screen.queryByText(/ここに変更の内容が出ます/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括編集の科目: 変更しない' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括編集のプロジェクト: 変更しない' })).toBeInTheDocument()
  })

  describe('項目の選択', () => {
    it('科目を選ぶと pick に反映され、「N行に適用」が出る(変更内容の一覧は出さない)', () => {
      const onPick = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11), sel(e1, 12)]} onPick={onPick} />)
      chooseTree('一括編集の科目', '変更しない', '食費')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 1 }))
      expect(screen.queryByText(/科目 → 食費/)).not.toBeInTheDocument()
      expect(applyButton()).toHaveTextContent('2行に適用')
      expect(applyButton()).toBeEnabled()
    })

    it('プロジェクトは「なし(外す)」も選べる。「変更しない」に戻すこともできる', () => {
      const onPick = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      chooseTree('一括編集のプロジェクト', '変更しない', '自宅')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'set', value: 30 } }))
      chooseTree('一括編集のプロジェクト', '自宅', 'なし(外す)')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'clear' } }))
      chooseTree('一括編集のプロジェクト', 'なし(外す)', '変更しない')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'keep' } }))
    })

    it('精算バッチは「なし(外す)」も選べる。「変更しない」に戻すこともできる', () => {
      const onPick = vi.fn()
      renderBar(<Harness selected={[sel(e2, 21)]} onPick={onPick} />)
      chooseBatch('一括編集の精算バッチ', '6月の割勘')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ batch: { kind: 'set', value: 7 } }))
      chooseBatch('一括編集の精算バッチ', 'なし(外す)')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ batch: { kind: 'clear' } }))
      chooseBatch('一括編集の精算バッチ', '変更しない')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ batch: { kind: 'keep' } }))
    })

    it('世帯メンバーを選ぶと pick に反映される', () => {
      const onPick = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      chooseMember('一括編集の世帯メンバー', '妻')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ memberId: 2 }))
    })
  })

  describe('選べない項目の先回りの無効化', () => {
    it('費用の行だけを選んでいれば、取引先を選べる(理由は出ない)', () => {
      const onPick = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeEnabled()
      chooseTree('一括編集の取引先', '変更しない', 'セブンイレブン')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ counterparty: { kind: 'set', value: 8 } }))
      expect(screen.queryByText('費用・収益の行のみ')).not.toBeInTheDocument()
    })

    it('資産の科目(普通預金)の行が混ざると、取引先は選べず、短い理由を出す', () => {
      renderBar(<Harness selected={[sel(e1, 11), sel(e1, 12)]} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      expect(screen.getByText('費用・収益の行のみ')).toBeInTheDocument()
    })

    it('立替金の行だけなら精算バッチを選べる。食費の行が混ざると選べず、理由を出す', () => {
      const { unmount } = renderBar(<Harness selected={[sel(e2, 21)]} />)
      expect(findBatchButton('一括編集の精算バッチ')).toBeEnabled()
      unmount()
      renderBar(<Harness selected={[sel(e2, 21), sel(e2, 22)]} />)
      expect(findBatchButton('一括編集の精算バッチ')).toBeDisabled()
      expect(screen.getByText('未収金・未払金(精算バッチ)の行のみ')).toBeInTheDocument()
    })

    it('既定の世帯メンバーがある科目に変えようとしているとき、世帯メンバーは選べない', () => {
      renderBar(<Harness selected={[sel(e1, 11)]} initialPick={{ ...EMPTY_BULK_PICK, accountId: 5 }} />)
      expect(findMemberButton('一括編集の世帯メンバー')).toBeDisabled()
      expect(screen.getByText('既定メンバーのある科目は不可')).toBeInTheDocument()
    })

    it('科目を費用の科目に一括で変えようとすると、資産の行が混ざっていても取引先を選べるようになる', () => {
      renderBar(<Harness selected={[sel(e1, 12)]} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      chooseTree('一括編集の科目', '変更しない', '食費')
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeEnabled()
    })

    it('科目を立替金に一括で変えようとすると、食費の行が混ざっていても精算バッチを選べるようになる', () => {
      renderBar(<Harness selected={[sel(e1, 11)]} />)
      expect(findBatchButton('一括編集の精算バッチ')).toBeDisabled()
      chooseTree('一括編集の科目', '変更しない', '立替金')
      expect(findBatchButton('一括編集の精算バッチ')).toBeEnabled()
    })

    it('選べなくなった項目の選択は外れる(取引先を選んだあと、科目を普通預金に変えると、取引先は「変更しない」に戻る)', () => {
      const onPick = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11)]} onPick={onPick} />)
      chooseTree('一括編集の取引先', '変更しない', 'セブンイレブン')
      chooseTree('一括編集の科目', '変更しない', '普通預金')
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 3, counterparty: { kind: 'keep' } }))
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
    })

    it('0行のとき(選択が空になった直後など)も、すべての項目が選べない', () => {
      renderBar(<Harness selected={[]} />)
      expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      expect(findBatchButton('一括編集の精算バッチ')).toBeDisabled()
      expect(findMemberButton('一括編集の世帯メンバー')).toBeDisabled()
    })
  })

  it('科目を変えて取引先・精算バッチが外れる行があるときは、確認の中でだけその旨を出す(確認前は出さない)', () => {
    const pick = { ...EMPTY_BULK_PICK, accountId: 3 }
    const { unmount } = renderBar(<Harness selected={[sel(e1, 11)]} initialPick={pick} />)
    expect(screen.queryByText(/取引先が外れます/)).not.toBeInTheDocument()
    unmount()
    renderBar(<Harness selected={[sel(e1, 11)]} initialPick={pick} initialConfirming />)
    expect(within(confirmDialog()).getByText(/取引先が付いている1行は、取引先が外れます/)).toBeInTheDocument()
  })

  describe('適用の2回押しの確認', () => {
    const picked: BulkPick = { ...EMPTY_BULK_PICK, project: { kind: 'set', value: 30 } }

    it('1回目の「N行に適用」では適用せず、確認を求める(onAskConfirm)', () => {
      const onApply = vi.fn()
      const onAskConfirm = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11), sel(e2, 21)]} initialPick={picked} onApply={onApply} onAskConfirm={onAskConfirm} />)
      fireEvent.click(applyButton())
      expect(onAskConfirm).toHaveBeenCalledTimes(1)
      expect(onApply).not.toHaveBeenCalled()
    })

    it('確認中は、更新する行数と元に戻せない旨を出し、「やめる」で確認を取り消せる', () => {
      const onCancelConfirm = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11), sel(e2, 21)]} initialPick={picked} initialConfirming onCancelConfirm={onCancelConfirm} />)
      expect(confirmDialog()).toHaveTextContent('2行(2件の仕訳)を更新します。元に戻せません。')
      fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
      expect(onCancelConfirm).toHaveBeenCalledTimes(1)
    })

    it('確認中の「本当に更新する」で、初めて onApply が呼ばれる', () => {
      const onApply = vi.fn()
      renderBar(<Harness selected={[sel(e1, 11)]} initialPick={picked} initialConfirming onApply={onApply} />)
      fireEvent.click(screen.getByRole('button', { name: '本当に更新する' }))
      expect(onApply).toHaveBeenCalledTimes(1)
    })

    it('項目を選び直すと、確認は取り消される(確認の表示が消え、「N行に適用」に戻る)', () => {
      renderBar(<Harness selected={[sel(e1, 11)]} initialPick={picked} initialConfirming />)
      expect(confirmDialog()).toBeInTheDocument()
      chooseMember('一括編集の世帯メンバー', '妻')
      expect(screen.queryByRole('dialog', { name: '一括編集の確認' })).not.toBeInTheDocument()
      expect(applyButton()).toBeInTheDocument()
    })

    it('保存中(busy)は、「N行に適用」も「本当に更新する」も押せない', () => {
      const { unmount } = renderBar(<Harness selected={[sel(e1, 11)]} initialPick={picked} busy />)
      expect(applyButton()).toBeDisabled()
      unmount()
      renderBar(<Harness selected={[sel(e1, 11)]} initialPick={picked} initialConfirming busy />)
      expect(screen.getByRole('button', { name: '本当に更新する' })).toBeDisabled()
    })
  })
})

describe('JournalLineBulkBar: マスタのその場追加(計画Issue #280)', () => {
  const createButton = (label: string) => within(screen.getByRole('dialog', { name: label })).queryByRole('button', { name: '+ 新規追加' })
  const open = (label: string, current = '変更しない') => fireEvent.click(screen.getByRole('button', { name: `${label}: ${current}` }))

  it('科目・プロジェクト・取引先の選択欄の末尾に「+ 新規追加」が出る(世帯メンバーには出ない)', () => {
    render(<Harness selected={[sel(e1, 11)]} onRequestCreateAccount={vi.fn()} onRequestCreateProject={vi.fn()} onRequestCreateCounterparty={vi.fn()} />)
    for (const label of ['一括編集の科目', '一括編集のプロジェクト', '一括編集の取引先']) {
      open(label)
      expect(createButton(label)).toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('dialog', { name: label }), { key: 'Escape' })
    }
    expect(screen.queryByRole('button', { name: '+ 新規追加' })).not.toBeInTheDocument()
  })

  it('追加の依頼先が渡されていない項目には、「+ 新規追加」を出さない', () => {
    render(<Harness selected={[sel(e1, 11)]} />)
    open('一括編集の科目')
    expect(createButton('一括編集の科目')).not.toBeInTheDocument()
  })

  it('科目の「+ 新規追加」を押すと依頼が出て、作成されたidが科目として選ばれる', () => {
    const onPick = vi.fn()
    const onRequestCreateAccount = vi.fn()
    render(<Harness selected={[sel(e1, 11)]} onPick={onPick} onRequestCreateAccount={onRequestCreateAccount} />)
    open('一括編集の科目')
    fireEvent.click(createButton('一括編集の科目') as HTMLElement)
    expect(onRequestCreateAccount).toHaveBeenCalledTimes(1)
    onRequestCreateAccount.mock.calls[0][0](1)
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 1 }))
  })

  it('プロジェクトの「+ 新規追加」で作成されたidが、プロジェクトとして選ばれる', () => {
    const onPick = vi.fn()
    const onRequestCreateProject = vi.fn()
    render(<Harness selected={[sel(e1, 11)]} onPick={onPick} onRequestCreateProject={onRequestCreateProject} />)
    open('一括編集のプロジェクト')
    fireEvent.click(createButton('一括編集のプロジェクト') as HTMLElement)
    onRequestCreateProject.mock.calls[0][0](30)
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ project: { kind: 'set', value: 30 } }))
  })

  it('取引先の「+ 新規追加」で作成されたidが、取引先として選ばれる', () => {
    const onPick = vi.fn()
    const onRequestCreateCounterparty = vi.fn()
    render(<Harness selected={[sel(e1, 11)]} onPick={onPick} onRequestCreateCounterparty={onRequestCreateCounterparty} />)
    open('一括編集の取引先')
    fireEvent.click(createButton('一括編集の取引先') as HTMLElement)
    onRequestCreateCounterparty.mock.calls[0][0](8)
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ counterparty: { kind: 'set', value: 8 } }))
  })

  it('取引先を選べない行(資産の行が混ざる)では、取引先の欄ごと押せないので、「+ 新規追加」にも届かない', () => {
    render(<Harness selected={[sel(e1, 11), sel(e1, 12)]} onRequestCreateCounterparty={vi.fn()} />)
    expect(screen.getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
  })

  it('作成した科目が選択欄の一覧に反映される前でも、先に選んでいた取引先の選択は落とさない(反映後に画面側が整理する)', () => {
    const onPick = vi.fn()
    const onRequestCreateAccount = vi.fn()
    render(
      <Harness
        selected={[sel(e1, 11)]}
        initialPick={{ ...EMPTY_BULK_PICK, counterparty: { kind: 'set', value: 8 } }}
        onPick={onPick}
        onRequestCreateAccount={onRequestCreateAccount}
      />,
    )
    open('一括編集の科目')
    fireEvent.click(createButton('一括編集の科目') as HTMLElement)
    // まだ一覧に無い新しい科目のid(99)が、作成の完了で渡される
    onRequestCreateAccount.mock.calls[0][0](99)
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 99, counterparty: { kind: 'set', value: 8 } }))
  })

  it('ダイアログを開いたまま(依頼しただけ)では、選択も確認中の状態も変わらない', () => {
    const onPick = vi.fn()
    render(
      <Harness
        selected={[sel(e1, 11)]}
        initialPick={{ ...EMPTY_BULK_PICK, project: { kind: 'set', value: 30 } }}
        onPick={onPick}
        onRequestCreateAccount={vi.fn()}
      />,
    )
    open('一括編集の科目')
    fireEvent.click(createButton('一括編集の科目') as HTMLElement)
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '一括編集のプロジェクト: 自宅' })).toBeInTheDocument()
  })
})
