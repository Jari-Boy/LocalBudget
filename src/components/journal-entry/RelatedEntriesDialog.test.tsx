// @vitest-environment jsdom
/**
 * 関連仕訳ダイアログ(計画Issue #138、UIレビューで仕訳詳細画面への常時インライン表示から
 * 「関連仕訳」ボタン押下で開くダイアログ方式に変更、さらに多対多のグルーピングを表現するため
 * グループ単位の塊として表示する方式に変更)のコンポーネントテスト。一覧の行自体がクリック
 * 対象であること(「詳細を見る」等の明示的なボタンを持たないこと)、複数グループに所属する場合
 * グループごとに別々の塊として表示されること(合算しないこと)、グループ名はクリックした場で
 * 編集でき確定・キャンセルボタンを持たないこと、関連付け候補がある場合のみ追加行が表示され
 * 候補を選ぶと即座にonAddEntryが呼ばれること、×ボタン・EscapeキーでonCloseが呼ばれることを
 * 検証する。外部依存なし(JournalEntryはテスト内で直接組み立てたプレーンオブジェクトを渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { RelatedEntryGroup } from '../../domain/journal-link-group/groupRelatedEntriesByLinkGroup'
import { RelatedEntriesDialog, type RelatedEntriesDialogProps } from './RelatedEntriesDialog'

afterEach(cleanup)

function buildEntry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  const id = overrides.id
  return {
    entryDate: '2026-08-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lines: [
      {
        id: id * 10 + 1,
        journalEntryId: id,
        accountId: 1,
        side: 'debit',
        amount: 1000,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        settlementBatchId: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: id * 10 + 2,
        journalEntryId: id,
        accountId: 2,
        side: 'credit',
        amount: 1000,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        settlementBatchId: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

function buildGroup(groupId: number, name: string | null, entries: JournalEntry[]): RelatedEntryGroup {
  return { groupId, name, entries }
}

function renderDialog(props?: Partial<RelatedEntriesDialogProps>) {
  const onSelectEntry = vi.fn()
  const onAddEntry = vi.fn()
  const onRenameGroup = vi.fn()
  const onRemoveEntry = vi.fn()
  const onClose = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <RelatedEntriesDialog
        relatedEntryGroups={[]}
        relateCandidates={[]}
        onSelectEntry={onSelectEntry}
        onAddEntry={onAddEntry}
        onRenameGroup={onRenameGroup}
        onRemoveEntry={onRemoveEntry}
        onClose={onClose}
        isAdding={false}
        addError={null}
        {...props}
      />
    </I18nextProvider>,
  )
  return { onSelectEntry, onAddEntry, onRenameGroup, onRemoveEntry, onClose }
}

describe('RelatedEntriesDialog', () => {
  it('関連する仕訳が無い場合、空メッセージが表示される', () => {
    renderDialog()
    expect(screen.getByText('関連付けられた仕訳はありません')).toBeInTheDocument()
  })

  it('1つのグループにのみ所属する場合、既定名「グループ1」の塊として表示される', () => {
    const related = buildEntry({ id: 2, entryDate: '2026-08-02', memo: '割勘' })
    renderDialog({ relatedEntryGroups: [buildGroup(10, null, [related])] })

    expect(screen.getByText('グループ1')).toBeInTheDocument()
    expect(screen.getByText('割勘')).toBeInTheDocument()
  })

  it('複数グループに所属する場合、グループごとに別々の塊として表示され、他の塊の仕訳と混ざらない', () => {
    const entryFromGroupA = buildEntry({ id: 2, entryDate: '2026-08-02', memo: 'バッチAの割勘' })
    const entryFromGroupB = buildEntry({ id: 3, entryDate: '2026-08-10', memo: 'バッチBの割勘' })
    renderDialog({
      relatedEntryGroups: [buildGroup(10, null, [entryFromGroupA]), buildGroup(20, null, [entryFromGroupB])],
    })

    expect(screen.getByText('グループ1')).toBeInTheDocument()
    expect(screen.getByText('グループ2')).toBeInTheDocument()
    const groupABox = screen.getByText('グループ1').closest('.related-group')! as HTMLElement
    const groupBBox = screen.getByText('グループ2').closest('.related-group')! as HTMLElement
    expect(within(groupABox).getByText('バッチAの割勘')).toBeInTheDocument()
    expect(within(groupABox).queryByText('バッチBの割勘')).not.toBeInTheDocument()
    expect(within(groupBBox).getByText('バッチBの割勘')).toBeInTheDocument()
  })

  it('グループに名前が設定されている場合、既定名ではなくその名前が表示される', () => {
    const related = buildEntry({ id: 2, entryDate: '2026-08-02', memo: '割勘' })
    renderDialog({ relatedEntryGroups: [buildGroup(10, '26/7生活費', [related])] })

    expect(screen.getByText('26/7生活費')).toBeInTheDocument()
    expect(screen.queryByText('グループ1')).not.toBeInTheDocument()
  })

  it('一覧の行をクリックすると、その行のonSelectEntryが呼ばれる(「詳細を見る」等の明示的なボタンは存在しない)', () => {
    const related = buildEntry({ id: 2, entryDate: '2026-08-02', memo: '割勘' })
    const { onSelectEntry } = renderDialog({ relatedEntryGroups: [buildGroup(10, null, [related])] })

    expect(screen.queryByRole('button', { name: /詳細を見る/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('割勘').closest('button')!)

    expect(onSelectEntry).toHaveBeenCalledWith(related)
  })

  it('グループ名をクリックして入力し直すと、確定・キャンセルボタンなしにEnterでonRenameGroupが呼ばれる', () => {
    const related = buildEntry({ id: 2 })
    const { onRenameGroup } = renderDialog({ relatedEntryGroups: [buildGroup(10, null, [related])] })

    fireEvent.click(screen.getByText('グループ1'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '26/7生活費' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameGroup).toHaveBeenCalledWith(10, '26/7生活費')
    expect(screen.queryByRole('button', { name: '関連付ける' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
  })

  it('グループ名の編集中にEscapeを押すと、onRenameGroupを呼ばずに元の表示に戻る', () => {
    const related = buildEntry({ id: 2 })
    const { onRenameGroup } = renderDialog({ relatedEntryGroups: [buildGroup(10, '26/7生活費', [related])] })

    fireEvent.click(screen.getByText('26/7生活費'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '書き換え中' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRenameGroup).not.toHaveBeenCalled()
    expect(screen.getByText('26/7生活費')).toBeInTheDocument()
  })

  it('各行には関連付けを解除するボタンがあり、押すとそのグループid・仕訳idでonRemoveEntryが呼ばれ、onSelectEntry(遷移)は呼ばれない', () => {
    const related = buildEntry({ id: 2, entryDate: '2026-08-02', memo: '割勘' })
    const { onRemoveEntry, onSelectEntry } = renderDialog({ relatedEntryGroups: [buildGroup(10, null, [related])] })

    fireEvent.click(screen.getByRole('button', { name: '関連付けを解除' }))

    expect(onRemoveEntry).toHaveBeenCalledWith(10, 2)
    expect(onSelectEntry).not.toHaveBeenCalled()
  })

  it('関連付け候補が無い場合、追加行は表示されない', () => {
    renderDialog({ relateCandidates: [] })
    expect(screen.queryByText('+ 関連仕訳を追加')).not.toBeInTheDocument()
  })

  it('関連付け候補がある場合、追加行を押すとセレクトが現れ、選ぶと確定ボタンなしに即座にonAddEntryが呼ばれる', () => {
    const candidate = buildEntry({ id: 2, entryDate: '2026-09-01', memo: '候補の仕訳' })
    const { onAddEntry } = renderDialog({ relateCandidates: [candidate] })

    fireEvent.click(screen.getByText('+ 関連仕訳を追加'))
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: String(candidate.id) } })

    expect(onAddEntry).toHaveBeenCalledWith(candidate.id)
  })

  it('addErrorが渡されると、エラーメッセージが表示される', () => {
    renderDialog({ addError: '関連付けに失敗しました。もう一度お試しください。' })
    expect(screen.getByRole('alert')).toHaveTextContent('関連付けに失敗しました。もう一度お試しください。')
  })

  it('×ボタンを押すとonCloseが呼ばれる', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escapeキーを押すとonCloseが呼ばれる', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
