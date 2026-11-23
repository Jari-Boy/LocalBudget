import { useState, type ReactNode } from 'react'
import { FloatingTableHeader } from './FloatingTableHeader'

export interface StickyHeaderTableProps {
  /** 表の横スクロール用の枠(overflow-x: auto など)のクラス名。枠の見た目(罫線・角丸・背景)は呼び出し側の CSS で決める */
  frameClassName: string
  /** 表のクラス名(本物の表と複製の両方に付く) */
  tableClassName: string
  /** 見出しの複製の置き場に付けるクラス名。枠に罫線・角丸がない表では loating-table-header--bare を渡す(複製に罫線・角丸を付けない) */
  floatingClassName?: string
  'aria-label'?: string
  /** 見出し(`<thead>`、1行)。本物の表と、ページのスクロールで固定する複製で同じものを使う */
  head: ReactNode
  /** 表の本文(`<tbody>` など) */
  children: ReactNode
}

/**
 * 見出しをページのスクロールで画面の上部に固定する表(計画Issue #266)。横スクロール用の枠・表・見出しの複製
 * (FloatingTableHeader)をまとめて出す。見出しが1行で、列幅が内容で決まる表(マスタ・割勘など)向けで、
 * 複製の列幅は本物の見出しから写す。複製は表の枠の直前に置くので、この部品が返す2つの要素を、表の高さ全体を囲む同じ親の中に置くこと。
 * 固定する高さは、上部に固定したタブの行などの下(CSS 変数 --sticky-head-h など。FloatingTableHeader.css を参照)。
 */
export function StickyHeaderTable({ frameClassName, tableClassName, floatingClassName, 'aria-label': ariaLabel, head, children }: StickyHeaderTableProps) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const [table, setTable] = useState<HTMLTableElement | null>(null)
  return (
    <>
      <FloatingTableHeader scroller={frame} table={table} syncColumnWidths className={floatingClassName} tableClassName={tableClassName}>
        {head}
      </FloatingTableHeader>
      <div className={frameClassName} ref={setFrame}>
        <table className={tableClassName} aria-label={ariaLabel} ref={setTable}>
          {head}
          {children}
        </table>
      </div>
    </>
  )
}