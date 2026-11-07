import { useEffect, useRef, type KeyboardEvent } from 'react'
import { formatCurrency } from '../../../infrastructure/i18n/formatCurrency'
import { formatDate } from '../../../infrastructure/i18n/formatDate'
import { DRAFT_TAG, SOURCE_TAGS, type JournalResultItem } from './journalResultModel'
import './JournalResultList.css'

export type SelectionMode = 'none' | 'single' | 'multiple'

export interface JournalResultListProps {
  items: readonly JournalResultItem[]
  selectionMode: SelectionMode
  selectedIds: readonly number[]
  onSelectionChange: (ids: readonly number[]) => void
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
}: JournalResultListProps) {
  const listRef = useRef<HTMLDivElement>(null)
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
            <li key={item.id}>
              <Row
                item={item}
                mode={selectionMode}
                selected={selectedIds.includes(item.id)}
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
  onPick,
}: {
  item: JournalResultItem
  mode: SelectionMode
  selected: boolean
  onPick: () => void
}) {
  const tag = item.sourceType === 'draft' ? DRAFT_TAG : SOURCE_TAGS[item.sourceType]
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
        {formatDate(toDate(item.entryDate))} ・ {item.debitSummary} → {item.creditSummary}
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
