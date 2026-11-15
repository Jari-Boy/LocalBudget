// @vitest-environment jsdom
/**
 * TemplatePickerDialog(計画Issue #201)のコンポーネントテスト。「テンプレートから起票」のダイアログ:
 * マスタの並び順・グループの見出しのまま一覧が出ること、検索語でグループ見出しの無い絞り込み表示になること、
 * 最初のテンプレートが選ばれた状態で開き、上下キーで選択を移し、Enterか「このテンプレートで起票」ボタン・
 * ダブルクリックで決定できること、Escapeかキャンセルで閉じること、開いたとき検索欄にフォーカスがあり、
 * Tab/Shift+Tabがダイアログの外に出ない(フォーカストラップ)こと、テンプレートが無いときの案内を検証する。
 * 外部依存なし(データは props で渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalTemplate } from '../../domain/journal-template/JournalTemplate'
import type { JournalTemplateGroup } from '../../domain/journal-template-group/JournalTemplateGroup'
import { TemplatePickerDialog } from './TemplatePickerDialog'

afterEach(cleanup)

const group = (id: number, name: string, sortOrder: number): JournalTemplateGroup => ({
  id,
  name,
  parentGroupId: null,
  sortOrder,
  isActive: true,
  createdAt: '',
  updatedAt: '',
})

const template = (id: number, name: string, groupId: number | null, sortOrder: number, amount: number | null = null): JournalTemplate => ({
  id,
  name,
  memo: null,
  bookkeeperHouseholdMemberId: null,
  groupId,
  sortOrder,
  isActive: true,
  lines: [
    { lineNo: 1, side: 'debit', accountId: 1, amount, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    { lineNo: 2, side: 'credit', accountId: 2, amount, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
  ],
  createdAt: '',
  updatedAt: '',
})

const base = {
  groups: [group(1, '食事', 0), group(2, '固定費', 1)],
  templates: [
    template(1, 'コンビニ(昼食)', 1, 0),
    template(2, 'カフェ', 1, 1),
    template(3, 'ジム月会費', 2, 0, 8800),
    template(4, '病院', null, 2),
  ],
  accountNameById: new Map([
    [1, '食費'],
    [2, '現金'],
  ]),
  counterpartyNameById: new Map<number, string>(),
}

function renderDialog(overrides: Partial<Parameters<typeof TemplatePickerDialog>[0]> = {}) {
  const onSelect = vi.fn()
  const onCancel = vi.fn()
  render(<TemplatePickerDialog {...base} onSelect={onSelect} onCancel={onCancel} {...overrides} />)
  return { onSelect, onCancel }
}

const options = () => screen.getAllByRole('option')
const selectedName = () => options().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent ?? ''

describe('TemplatePickerDialog: 表示', () => {
  it('モーダルのダイアログで、マスタの並び順のまま、グループの見出しの下にテンプレートが並ぶ', () => {
    renderDialog()

    expect(screen.getByRole('dialog', { name: 'テンプレートから起票' })).toHaveAttribute('aria-modal', 'true')
    const list = screen.getByRole('listbox')
    expect(within(list).getAllByText(/^(食事|固定費)$/)).toHaveLength(2)
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('コンビニ(昼食)'),
      expect.stringContaining('カフェ'),
      expect.stringContaining('ジム月会費'),
      expect.stringContaining('病院'),
    ])
  })

  it('各テンプレートに内容(科目)と金額(固定は金額、空欄は「金額は入力」)を出す', () => {
    renderDialog()

    const gym = options().find((o) => o.textContent?.includes('ジム月会費'))!
    expect(within(gym).getByText('食費 / 現金')).toBeInTheDocument()
    expect(within(gym).getByText('￥8,800')).toBeInTheDocument()
    const hospital = options().find((o) => o.textContent?.includes('病院'))!
    expect(within(hospital).getByText('金額は入力')).toBeInTheDocument()
  })

  it('開いたとき、検索欄にフォーカスがあり、最初のテンプレートが選ばれている', () => {
    renderDialog()

    expect(screen.getByRole('searchbox', { name: 'テンプレートを検索' })).toHaveFocus()
    expect(selectedName()).toContain('コンビニ(昼食)')
  })

  it('テンプレートが1つも無いときは案内を出し、決定ボタンは押せない', () => {
    renderDialog({ templates: [], groups: [] })

    expect(screen.getByText('テンプレートがありません。仕訳画面の「テンプレート」タブで追加できます')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'このテンプレートで起票' })).toBeDisabled()
  })
})

describe('TemplatePickerDialog: 検索', () => {
  it('検索語を入れると、グループの見出しを出さず、該当するテンプレートだけを並べる', () => {
    renderDialog()

    fireEvent.change(screen.getByRole('searchbox', { name: 'テンプレートを検索' }), { target: { value: '食費' } })

    expect(screen.queryByText('食事')).toBeNull()
    expect(options()).toHaveLength(4) // 4件とも借方が食費
    fireEvent.change(screen.getByRole('searchbox', { name: 'テンプレートを検索' }), { target: { value: 'ジム' } })
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('ジム月会費')])
  })

  it('該当が無いときは案内を出し、決定ボタンは押せない', () => {
    renderDialog()

    fireEvent.change(screen.getByRole('searchbox', { name: 'テンプレートを検索' }), { target: { value: 'zzz' } })

    expect(screen.getByText('該当するテンプレートがありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'このテンプレートで起票' })).toBeDisabled()
  })

  it('検索で絞ると、選択は絞り込み後の先頭に移る', () => {
    renderDialog()

    fireEvent.change(screen.getByRole('searchbox', { name: 'テンプレートを検索' }), { target: { value: 'ジム' } })

    expect(selectedName()).toContain('ジム月会費')
  })
})

describe('TemplatePickerDialog: 選択と決定', () => {
  it('上下キーで選択が動き、先頭・末尾で止まる', () => {
    renderDialog()
    const search = screen.getByRole('searchbox', { name: 'テンプレートを検索' })

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(selectedName()).toContain('カフェ')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(selectedName()).toContain('病院')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(selectedName()).toContain('ジム月会費')
  })

  it('Enterで、選ばれているテンプレートで決定する', () => {
    const { onSelect } = renderDialog()
    const search = screen.getByRole('searchbox', { name: 'テンプレートを検索' })

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 2, name: 'カフェ' })
  })

  it('行をクリックすると選ばれ、「このテンプレートで起票」で決定する', () => {
    const { onSelect } = renderDialog()

    fireEvent.click(options().find((o) => o.textContent?.includes('病院'))!)
    expect(selectedName()).toContain('病院')
    fireEvent.click(screen.getByRole('button', { name: 'このテンプレートで起票' }))

    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 4 })
  })

  it('行をダブルクリックすると、その場で決定する', () => {
    const { onSelect } = renderDialog()

    fireEvent.doubleClick(options().find((o) => o.textContent?.includes('ジム月会費'))!)

    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 3 })
  })

  it('Escapeとキャンセルボタンで閉じる(決定はしない)', () => {
    const { onSelect, onCancel } = renderDialog()

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'テンプレートを検索' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TemplatePickerDialog: フォーカストラップ', () => {
  it('最後の要素でTabを押すと検索欄へ戻り、検索欄でShift+Tabを押すと最後の要素へ移る', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'テンプレートから起票' })
    const search = screen.getByRole('searchbox', { name: 'テンプレートを検索' })
    const confirm = screen.getByRole('button', { name: 'このテンプレートで起票' })

    confirm.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(search).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
  })
})
