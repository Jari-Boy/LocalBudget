import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import './FloatingTableHeader.css'

export interface FloatingTableHeaderProps {
  /** 横スクロールする表の枠(overflow-x: auto の要素)。複製をその横スクロールに合わせて動かす */
  scroller: HTMLElement | null
  /** 本物の表。見出しがスクロールアウトしたかの判断に使う */
  table: HTMLTableElement | null
  /**
   * 本物の見出しの列幅と表の幅を、固定中に複製へ写す。列幅が内容で決まる表(自動レイアウト)向け。複製は見出しだけなので、
   * 何もしないと列幅が本物とずれる。列幅を colgroup で決めている表では不要(渡さない)。見出しは1行の表だけに対応する
   */
  syncColumnWidths?: boolean
  /** 複製の置き場(固定の要素)に付けるクラス名。本物の表の枠の中でだけ効くスタイルを、複製にも当てるために使う */
  className?: string
  /** 複製の表に付けるクラス名・スタイル(列幅・文字の大きさを本物の表と揃える) */
  tableClassName?: string
  tableStyle?: CSSProperties
  /** 複製の表の中身(`<colgroup>` と `<thead>`)。本物の表の見出しと同じものを渡す */
  children: ReactNode
}

/**
 * 横スクロールする表の見出しを、ページのスクロールで画面の上部に固定する(計画Issue #266)。
 * 横スクロール用の枠(overflow-x: auto)の中では、`position: sticky` の見出しはページのスクロールでは固定されない
 * (枠自身の縦スクロールにしか効かない)。枠の内側にスクロールを作ると、枠の端でページのスクロールに引き継がれて
 * 見出しが隠れて使いにくいため、表の枠の外に見出しの複製を置く。複製は、画面の上部に固定する高さ(CSS の `top`)で
 * `position: sticky` にし、本物の見出しがその位置より上へスクロールアウトしている間だけ見せる。
 * 見せている間は表の横スクロールに合わせて動かし、列を本物の見出しとずらさない。見せていない間は、支援技術にも操作にも出さない。
 * 置く場所は、表の枠の直前(同じ親の中)。固定する高さは `.floating-table-header` の `top`(CSS 変数)で決める。
 */
export function FloatingTableHeader({ scroller, table, syncColumnWidths = false, className, tableClassName, tableStyle, children }: FloatingTableHeaderProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cloneRef = useRef<HTMLTableElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  // 親が縦並びの flex で gap を持つとき、高さ0のこの置き場の分だけ余白が増える。その gap の分を打ち消す
  useLayoutEffect(() => {
    const root = rootRef.current
    const parent = root?.parentElement
    if (root === null || parent === null || parent === undefined) return
    const style = getComputedStyle(parent)
    const gap = Number.parseFloat(style.rowGap)
    root.style.marginBottom = style.display.includes('flex') && style.flexDirection.startsWith('column') && gap > 0 ? `${-gap}px` : ''
  }, [])
  // 固定すべきかの判断: ページのスクロール・画面の大きさの変更のたびに、本物の見出しの位置と比べる
  useEffect(() => {
    const root = rootRef.current
    if (root === null || table === null) return
    const update = () => {
      const head = table.tHead
      if (head === null) return
      const fixedTop = root.getBoundingClientRect().top
      const headerHeight = cloneRef.current?.tHead?.offsetHeight ?? 0
      // 本物の見出しが固定の位置より上へ出ていて、表の下端がまだ複製の下まである間だけ見せる
      const nextStuck = head.getBoundingClientRect().top < fixedTop - 0.5 && table.getBoundingClientRect().bottom > fixedTop + headerHeight
      setStuck(nextStuck)
      if (nextStuck) {
        // 複製の位置と幅を、表の枠に合わせる(枠が親より狭い・ずれているときも、本物の見出しの真上に重なる)
        const clip = clipRef.current
        const scrollerRect = scroller?.getBoundingClientRect()
        if (clip !== null && scrollerRect !== undefined) {
          clip.style.left = `${scrollerRect.left - root.getBoundingClientRect().left}px`
          clip.style.width = `${scrollerRect.width}px`
        }
        if (syncColumnWidths) copyColumnWidths(table, cloneRef.current)
      }
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    // 絞り込みなどで表の大きさが変わっても、列幅を写し直す
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(table)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [table, scroller, syncColumnWidths])

  // 横スクロールの同期: 表の枠の横スクロールと同じだけ、複製を動かす(再描画せず直接動かす)
  useEffect(() => {
    if (scroller === null) return
    const sync = () => {
      if (cloneRef.current !== null) cloneRef.current.style.transform = `translateX(-${scroller.scrollLeft}px)`
    }
    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    return () => scroller.removeEventListener('scroll', sync)
  }, [scroller])

  return (
    <div
      ref={rootRef}
      className={className === undefined ? 'floating-table-header' : `floating-table-header ${className}`}
      data-stuck={stuck}
      aria-hidden={!stuck}
      inert={!stuck}
    >
      <div ref={clipRef} className="floating-table-header__clip">
        <table ref={cloneRef} className={tableClassName} style={tableStyle}>
          {children}
        </table>
      </div>
    </div>
  )
}

/** 本物の見出しの各列の幅と表の幅を、複製の表に写す(複製の列を、本物の見出しの列と同じ幅・同じ位置にする) */
function copyColumnWidths(source: HTMLTableElement, clone: HTMLTableElement | null): void {
  const sourceCells = source.tHead?.rows[0]?.cells
  const cloneCells = clone?.tHead?.rows[0]?.cells
  if (clone === null || sourceCells === undefined || cloneCells === undefined) return
  clone.style.tableLayout = 'fixed'
  clone.style.width = `${source.getBoundingClientRect().width}px`
  Array.from(cloneCells).forEach((cell, index) => {
    const sourceCell = sourceCells[index]
    if (sourceCell === undefined) return
    // 本物の見出しのセル全体の幅(パディングを含む)なので、border-box にして、パディングの分だけ広がらないようにする
    cell.style.boxSizing = 'border-box'
    cell.style.width = `${sourceCell.getBoundingClientRect().width}px`
  })
}