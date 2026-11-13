import { useRef, useState } from 'react'
import {
  DEFAULT_COLUMN_WIDTHS,
  isDefaultColumnWidths,
  loadColumnWidths,
  resizeColumn,
  saveColumnWidths,
  type ColumnKey,
} from './journalLineTableColumns'

/** 明細行単位の表の列幅の状態と操作(計画Issue #182)。表の外(画面の「列幅を初期値に戻す」ボタン)からも操作できるよう、フックにして共有する */
export interface JournalLineTableColumns {
  widths: Record<ColumnKey, number>
  /** 最新の列幅。ドラッグ・キー操作の途中で、再描画を待たずに次の幅を求めるため */
  widthsRef: { readonly current: Record<ColumnKey, number> }
  resizeTo: (key: ColumnKey, width: number) => void
  /** 現在の列幅を保存する(初期値のままなら保存を消す) */
  commit: () => void
  resetColumn: (key: ColumnKey) => void
  resetAll: () => void
  /** すべての列が初期の幅のまま */
  isDefault: boolean
}

export function useJournalLineTableColumns(): JournalLineTableColumns {
  const [widths, setWidths] = useState(loadColumnWidths)
  const widthsRef = useRef(widths)

  const apply = (next: typeof widths) => {
    widthsRef.current = next
    setWidths(next)
  }

  return {
    widths,
    widthsRef,
    resizeTo: (key, width) => apply(resizeColumn(widthsRef.current, key, width)),
    commit: () => saveColumnWidths(widthsRef.current),
    resetColumn: (key) => {
      apply({ ...widthsRef.current, [key]: DEFAULT_COLUMN_WIDTHS[key] })
      saveColumnWidths(widthsRef.current)
    },
    resetAll: () => {
      apply({ ...DEFAULT_COLUMN_WIDTHS })
      saveColumnWidths(widthsRef.current)
    },
    isDefault: isDefaultColumnWidths(widths),
  }
}
