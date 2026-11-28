import type { ReactNode } from 'react'
import type { SortDirection } from './tableSort'
import './SortableHeaderCell.css'

export interface SortableHeaderCellProps {
  /** 見出しの文字。ボタンの名前になる */
  label: string
  /** この列がいま並んでいる向き。この列で並べていなければ null */
  direction: SortDirection | null
  /** ボタンを押したとき。次の状態(昇順→降順→解除)は呼び出し側が決める */
  onSort: () => void
  className?: string
  scope?: 'col' | 'colgroup' | 'row' | 'rowgroup'
  /** 列幅のつまみなど、同じセルに置く追加の中身 */
  children?: ReactNode
}

/**
 * 並び替えできる列の見出しのセル(計画Issue #302。明細取込の見出しを共通部品にした)。見出しの見た目のまま、
 * 押せることを矢印で示し、ボタンで 昇順→降順→解除 を切り替える。いまの状態は aria-sort で伝える(並べていない列は none)。
 * 並び替えの状態と、押したときの次の状態は呼び出し側が持つ(common/table-sort/tableSort)。
 */
export function SortableHeaderCell({ label, direction, onSort, className, scope, children }: SortableHeaderCellProps) {
  return (
    <th className={className} scope={scope} aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
      <button type="button" className={`table-sort${direction !== null ? ' table-sort--on' : ''}`} onClick={onSort}>
        <span>{label}</span>
        <svg className="table-sort__mark" viewBox="0 0 12 12" aria-hidden="true">
          <path d={direction === 'asc' ? 'M2.5 8L6 4l3.5 4' : direction === 'desc' ? 'M2.5 4L6 8l3.5-4' : 'M3.5 4.5L6 2l2.5 2.5M3.5 7.5L6 10l2.5-2.5'} />
        </svg>
      </button>
      {children}
    </th>
  )
}
