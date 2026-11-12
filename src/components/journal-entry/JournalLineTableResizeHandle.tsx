import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './journalLineTableColumns'

/** キーボード(←→)で1回に増減する幅(px) */
const KEY_STEP = 8

export interface JournalLineTableResizeHandleProps {
  /** つまみの名前(「日付の列幅」など) */
  label: string
  /** いまの列幅(設定値、px) */
  value: number
  /**
   * 画面に出ている幅 ÷ 列幅の設定値。表が枠より狭いとき、余った幅は各列に比例して配られるため、ドラッグした分だけ
   * 列が動くよう、ドラッグ量をこれで割って補正する。測れないとき(0・NaN)は1として扱う
   */
  getScale: () => number
  /** 新しい列幅(丸める前の値)。ドラッグ中は動くたびに呼ばれる */
  onResize: (width: number) => void
  /** 調整が一区切りついたとき(ドラッグを離す・キーを押す)。呼び出し側が保存する */
  onCommit: () => void
  /** ダブルクリックまたはHomeキー: この列を初期の幅に戻す */
  onReset: () => void
}

/**
 * 表の列見出しの右端に置く、列幅を変えるつまみ(計画Issue #182)。ドラッグ・キーボード(←→で増減、Homeで
 * 初期値)・ダブルクリック(初期値)で操作できる。スクリーンリーダーには、縦向きの区切り(separator)として
 * いまの幅と範囲を伝える(WAI-ARIAのウィンドウ分割のパターン)。
 */
export function JournalLineTableResizeHandle({ label, value, getScale, onResize, onCommit, onReset }: JournalLineTableResizeHandleProps) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // ポインタを掴めない環境でも、ドラッグ自体は動く
    }
    const scale = getScale()
    drag.current = { x: event.clientX, width: value, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 }
    setDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const start = drag.current
    if (start === null) return
    onResize(start.width + (event.clientX - start.x) / start.scale)
  }

  const endDrag = () => {
    if (drag.current === null) return
    drag.current = null
    setDragging(false)
    onCommit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      onResize(value + (event.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP))
      onCommit()
    } else if (event.key === 'Home') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      className="journal-line-table__resizer"
      data-dragging={dragging ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
    />
  )
}
