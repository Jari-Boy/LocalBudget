// @vitest-environment jsdom
/**
 * 仕訳の詳細の最下部の関連仕訳(RelatedEntriesSection、計画Issue #152)のコンポーネントテスト。
 * グループ単位の表示、既存グループへの追加、新しいグループを作って追加、別グループ・新しいグループへの
 * 移動、解除、グループ名の変更を検証する。
 * 外部依存なし(グループ・候補・絞り込みの選択肢は props で渡し、操作は props のコールバックで受ける)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { RelatedEntryGroup } from '../../domain/journal-link-group/groupRelatedEntriesByLinkGroup'
import { RelatedEntriesSection, type RelatedEntriesSectionProps } from './RelatedEntriesSection'

afterEach(cleanup)

function entry(id: number, memo: string, amount: number): JournalEntry {
  return {
    id,
    entryDate: '2026-10-05',
    memo,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '',
    updatedAt: '',
    lines: [
      { id: id * 10, accountId: 1, side: 'debit', amount },
      { id: id * 10 + 1, accountId: 2, side: 'credit', amount },
    ],
  } as JournalEntry
}

const groups: RelatedEntryGroup[] = [
  { groupId: 7, name: '旅行', entries: [entry(2, '宿泊', 12000)] },
  { groupId: 8, name: null, entries: [entry(3, '交通費', 3000)] },
]

function renderSection(overrides: Partial<RelatedEntriesSectionProps> = {}) {
  const props: RelatedEntriesSectionProps = {
    groups,
    findCandidates: () => [entry(9, '候補の仕訳', 500)],
    filterOptions: {
      accountCategories: [],
      counterpartyCategories: [],
      projectCategories: [],
      members: [],
      batches: [],
      sourceTypes: [],
    },
    onOpenEntry: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onAdd: vi.fn(),
    onAddToNewGroup: vi.fn(),
    ...overrides,
  }
  render(<RelatedEntriesSection {...props} />)
  return props
}

describe('RelatedEntriesSection', () => {
  it('「+ 関連付ける仕訳を追加」から候補を選ぶと onAdd が呼ばれ、ポップアップが閉じる', () => {
    const props = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ 関連付ける仕訳を追加' }))
    const popup = screen.getByRole('dialog', { name: '関連付ける仕訳を選ぶ' })
    fireEvent.click(within(popup).getByRole('button', { name: /候補の仕訳/ }))

    expect(props.onAdd).toHaveBeenCalledWith(9)
    expect(props.onAddToNewGroup).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '関連付ける仕訳を選ぶ' })).not.toBeInTheDocument()
  })

  it('「+ 新しいグループ」から候補を選ぶと onAddToNewGroup が呼ばれ、既存グループへの追加(onAdd)は呼ばれない', () => {
    const props = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ 新しいグループ' }))
    const popup = screen.getByRole('dialog', { name: '新しいグループに関連付ける仕訳を選ぶ' })
    fireEvent.click(within(popup).getByRole('button', { name: /候補の仕訳/ }))

    expect(props.onAddToNewGroup).toHaveBeenCalledWith(9)
    expect(props.onAdd).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('グループが無い場合でも「+ 新しいグループ」が使える', () => {
    renderSection({ groups: [] })
    expect(screen.getByText('関連付けられた仕訳はありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 新しいグループ' })).toBeInTheDocument()
  })

  it('別のグループを選んで移動すると、移動元・移動先のグループidと仕訳idで onMove が呼ばれる', () => {
    const props = renderSection()
    fireEvent.change(screen.getByLabelText('2026-10-05 宿泊を別のグループへ移動'), { target: { value: '8' } })

    expect(props.onMove).toHaveBeenCalledWith(7, 8, 2)
  })

  it('移動先に「新しいグループ」を選ぶと、移動先を null にして onMove が呼ばれる', () => {
    const props = renderSection()
    fireEvent.change(screen.getByLabelText('2026-10-05 交通費を別のグループへ移動'), { target: { value: 'new' } })

    expect(props.onMove).toHaveBeenCalledWith(8, null, 3)
  })

  it('移動先のセレクトには自分のグループが含まれない', () => {
    renderSection()
    const select = screen.getByLabelText('2026-10-05 宿泊を別のグループへ移動')
    const labels = within(select).getAllByRole('option').map((o) => o.textContent)

    expect(labels).toEqual(['移動', 'グループ2', '新しいグループ'])
  })

  it('解除を押すと onRemove がグループidと仕訳idで呼ばれる', () => {
    const props = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '2026-10-05 宿泊を解除' }))

    expect(props.onRemove).toHaveBeenCalledWith(7, 2)
  })

  it('グループ名を書き換えて離れると onRename が呼ばれ、空にすると null で呼ばれる', () => {
    const props = renderSection()
    const [first, second] = screen.getAllByLabelText('グループ名')
    fireEvent.change(first, { target: { value: '沖縄旅行' } })
    fireEvent.blur(first)
    expect(props.onRename).toHaveBeenCalledWith(7, '沖縄旅行')

    fireEvent.change(second, { target: { value: '   ' } })
    fireEvent.blur(second)
    expect(props.onRename).toHaveBeenCalledTimes(1)

    fireEvent.change(first, { target: { value: '' } })
    fireEvent.blur(first)
    expect(props.onRename).toHaveBeenLastCalledWith(7, null)
  })
})
