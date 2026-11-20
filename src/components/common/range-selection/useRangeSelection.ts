import { useId, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { extendSelectionByArrow, pickItem } from './rangeSelectionModel'

export interface UseRangeSelectionParams<Id extends string | number> {
  /** 表示中の行のidの並び(画面に見える順。折りたたみ・絞り込みで隠れた行は含めない) */
  order: readonly Id[]
  selected: readonly Id[]
  onChange: (next: Id[]) => void
  /** 選べない行(例: 重複で選択欄のない行)。範囲選択に含めず、押しても切り替えない */
  isSelectable?: (id: Id) => boolean
  /** 範囲選択がまたがない単位(例: 借方側と貸方側) */
  scopeOf?: (id: Id) => unknown
}

/**
 * チェックボックスで複数選択できる画面の、Shift+クリックの範囲選択・Ctrl/Cmd+クリックのトグル・Shift+↑↓のキーボード範囲選択
 * (計画Issue #235 D)。ルールは純粋関数(rangeSelectionModel)に任せ、基点(最後に操作した行)の保持と、イベント・フォーカスとの
 * 橋渡しだけを持つ。選択の状態そのものは呼び出し側が持つ(selected と onChange)。
 *
 * 使い方: チェックボックスに `{...checkboxProps(id)}` を渡す(押す・Shift+↑↓を扱う。`checked` と `disabled` は画面が渡す)。
 * 行のどこを押してもチェックを切り替える画面は、行に `{...rowProps(id)}` も渡す。
 * Shift+↑↓は、チェックボックスにフォーカスがあるときだけ働く(入力欄・select の中のキーは奪わない)。
 */
export function useRangeSelection<Id extends string | number>({ order, selected, onChange, isSelectable, scopeOf }: UseRangeSelectionParams<Id>) {
  const anchorRef = useRef<Id | null>(null)
  /** フォーカス移動の探索を、同じフックのチェックボックスだけに絞る(画面に複数の一覧があっても混ざらない) */
  const group = useId()

  const pick = (id: Id, modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const result = pickItem({
      order,
      selected,
      // 選択が空のときは、前の基点を使わない(解除したら、また最初から選び始める)
      anchor: selected.length === 0 ? null : anchorRef.current,
      id,
      modifiers,
      isSelectable,
      scopeOf,
    })
    anchorRef.current = result.anchor
    onChange(result.selected)
  }

  /** Shift+クリックでブラウザが文字列を選択してしまうのを防ぐ */
  const preventShiftTextSelection = (event: MouseEvent<HTMLElement>) => {
    if (event.shiftKey) event.preventDefault()
  }

  const onCheckboxKeyDown = (event: KeyboardEvent<HTMLInputElement>, id: Id) => {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const result = extendSelectionByArrow({
      order,
      selected,
      anchor: selected.length === 0 ? null : anchorRef.current,
      focusedId: id,
      direction: event.key === 'ArrowDown' ? 'down' : 'up',
      isSelectable,
      scopeOf,
    })
    if (result.focusId === null) return
    // ページのスクロール(Shift+↑↓の既定動作)を起こさない
    event.preventDefault()
    anchorRef.current = result.anchor
    onChange(result.selected)
    const next = Array.from(event.currentTarget.ownerDocument.querySelectorAll<HTMLElement>(`[data-range-group="${group}"]`)).find(
      (element) => element.dataset.rangeId === String(result.focusId),
    )
    next?.focus()
  }

  return {
    /**
     * チェックボックスに渡す props。押したときの切り替え(修飾キーで範囲・トグル)とキー操作を扱う。
     * 切り替えは onClick で行うため、onChange は何もしない(押したときの修飾キーは onChange では分からない)
     */
    checkboxProps: (id: Id) => ({
      'data-range-id': String(id),
      'data-range-group': group,
      onClick: (event: MouseEvent<HTMLInputElement>) => pick(id, event),
      onChange: () => undefined,
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => onCheckboxKeyDown(event, id),
      onMouseDown: preventShiftTextSelection,
    }),
    /**
     * 行に渡す props。行のどこを押しても、チェックボックスを押したのと同じ規則で切り替える。
     * チェックボックス自身を押したときは(checkboxProps が扱うので)二重に切り替えない
     */
    rowProps: (id: Id) => ({
      onClick: (event: MouseEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest('[data-range-id]') !== null) return
        pick(id, event)
      },
      onMouseDown: preventShiftTextSelection,
    }),
  }
}
