import { useEffect, useRef, type KeyboardEvent } from 'react'
import { formatCurrency } from '../../../infrastructure/i18n/formatCurrency'
import { formatDate } from '../../../infrastructure/i18n/formatDate'
import { useRangeSelection } from '../range-selection/useRangeSelection'
import { DRAFT_TAG, resolveSourceTag, type JournalResultItem } from './journalResultModel'
import './JournalResultList.css'

export type SelectionMode = 'none' | 'single' | 'multiple'

export interface JournalResultListProps {
  items: readonly JournalResultItem[]
  selectionMode: SelectionMode
  selectedIds: readonly number[]
  onSelectionChange: (ids: readonly number[]) => void
  /** trueのとき、科目(借方→貸方)を出さない(承認待ちの定期仕訳タブ、計画Issue #164) */
  hideAccounts?: boolean
  /**
   * 渡すと、各行に詳細の選択(selectionMode)とは別のチェックボックスを付ける(まとめて確定用、計画Issue #164)。
   * チェックボックスを押すと、変わった後のチェック全体をonChangeで通知し、選択は変えない。Shift+クリックの範囲選択、
   * Ctrl/Cmd+クリックのトグル、Shift+↑↓での範囲の拡張は、共通フックが決める(計画Issue #235 D)。チェックの連動などの
   * 規則は呼び出し側が持つ(渡された変更後のチェックを、規則に合わせて直してから反映する)
   */
  checkable?: { checkedIds: readonly number[]; onChange: (ids: number[]) => void }
}

function toDate(entryDate: string): Date {
  const [year, month, day] = entryDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * 仕訳の結果一覧(計画Issue #150)。1仕訳1行の要約(出どころタグ・摘要・金額・日付・
 * 借方→貸方の代表科目と「ほかN件」)を並べる。選択なし・単一・複数を切り替えられ、
 * ↑↓キーで移動できる(単一は選択を移動、複数はフォーカスだけを移動する)。
 * 表示用に整形済みの行データ(JournalResultItem)だけを受け取り、DB・Repositoryには依存しない。
 */
export function JournalResultList({
  items,
  selectionMode,
  selectedIds,
  onSelectionChange,
  hideAccounts = false,
  checkable,
}: JournalResultListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  // checkable のチェックの範囲選択・トグル選択(計画Issue #235 D)
  const range = useRangeSelection<number>({
    order: items.map((item) => item.id),
    selected: checkable?.checkedIds ?? [],
    onChange: (next) => checkable?.onChange(next),
  })
  // キー操作で選択を移したときだけ、再描画後にその行へフォーカスを移す
  const pendingFocusId = useRef<number | null>(null)

  useEffect(() => {
    if (pendingFocusId.current === null) return
    listRef.current?.querySelector<HTMLElement>('[data-entry-id="' + pendingFocusId.current + '"]')?.focus()
    pendingFocusId.current = null
  })

  const focusRow = (id: number) => {
    listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)?.focus()
  }

  const toggle = (id: number) =>
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (selectionMode === 'none') return
    // チェックの Shift+↑↓(範囲の拡張)など、子が処理済みのキーでは、選択を移さない(計画Issue #235 D)
    if (event.defaultPrevented) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1

    if (selectionMode === 'single') {
      const current = items.findIndex((item) => item.id === selectedIds[0])
      const next = items[current === -1 && delta === 1 ? 0 : current + delta]
      if (!next) return
      pendingFocusId.current = next.id
      onSelectionChange([next.id])
      return
    }

    const focusedId = Number(
      (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId,
    )
    const current = items.findIndex((item) => item.id === focusedId)
    const next = items[current === -1 ? 0 : current + delta]
    if (next) focusRow(next.id)
  }

  return (
    <div
      ref={listRef}
      role="group"
      aria-label="仕訳一覧。上下キーで選択を移動"
      className="journal-result-list"
      tabIndex={selectionMode === 'none' ? undefined : 0}
      onKeyDown={handleKeyDown}
    >
      {items.length === 0 ? (
        <p className="journal-result-list__empty">該当する仕訳がありません</p>
      ) : (
        <ul className="journal-result-list__items">
          {items.map((item) => (
            <li
              key={item.id}
              className={checkable ? 'journal-result-list__item--checkable' : undefined}
              // Ctrl/Cmd を押したまま行のどこかを押すと、詳細表示の選択を変えずチェックの操作にする(checkable のときだけ。計画Issue #235 D)
              {...(checkable ? range.selectingRowProps(item.id) : {})}
            >
              {checkable && (
                <input
                  type="checkbox"
                  className="journal-result-list__check"
                  aria-label={`${item.memo} ${formatDate(toDate(item.entryDate))}を選択`}
                  checked={checkable.checkedIds.includes(item.id)}
                  {...range.checkboxProps(item.id)}
                />
              )}
              <Row
                item={item}
                mode={selectionMode}
                selected={selectedIds.includes(item.id)}
                hideAccounts={hideAccounts}
                onPick={() => (selectionMode === 'single' ? onSelectionChange([item.id]) : toggle(item.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({
  item,
  mode,
  selected,
  hideAccounts,
  onPick,
}: {
  item: JournalResultItem
  mode: SelectionMode
  selected: boolean
  hideAccounts: boolean
  onPick: () => void
}) {
  const tag = item.sourceType === 'draft' ? DRAFT_TAG : resolveSourceTag(item.sourceType, item.financialInstitutionName)
  const content = (
    <>
      <span className="journal-result-list__line">
        <span className="journal-result-list__title">
          <span className="journal-result-list__tag" style={{ background: tag.bg, color: tag.fg }}>
            {tag.label}
          </span>
          <span className="journal-result-list__memo">{item.memo}</span>
        </span>
        <span className="journal-result-list__amount">{formatCurrency(item.amount, item.currency)}</span>
      </span>
      <span className="journal-result-list__sub">
        {formatDate(toDate(item.entryDate))}
        {item.note ? ` ・ ${item.note}` : ''}
        {hideAccounts ? '' : ` ・ ${item.debitSummary} / ${item.creditSummary}`}
      </span>
    </>
  )

  if (mode === 'none') {
    return <div className="journal-result-list__row">{content}</div>
  }
  if (mode === 'single') {
    return (
      <button
        type="button"
        data-entry-id={item.id}
        className={`journal-result-list__row journal-result-list__row--button${selected ? ' journal-result-list__row--selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onClick={onPick}
      >
        {content}
      </button>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      data-entry-id={item.id}
      className={`journal-result-list__row journal-result-list__row--button${selected ? ' journal-result-list__row--selected' : ''}`}
      aria-checked={selected}
      onClick={onPick}
    >
      <span aria-hidden="true" className="journal-result-list__box">
        {selected ? '☑' : '☐'}
      </span>
      <span className="journal-result-list__body">{content}</span>
    </button>
  )
}
