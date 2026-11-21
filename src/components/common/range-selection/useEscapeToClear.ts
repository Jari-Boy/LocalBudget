import { useEffect, useRef } from 'react'
import { ownsEscapeKey } from '../keyboardTarget'

/**
 * 「Esc で選択を全解除」(計画Issue #235 C・D)。チェックボックスで複数選択できる画面が、画面ごとにキー操作を書かず、同じ規則で
 * Esc による全解除を持つための共通フック。
 *
 * - 解除する処理(onClear)は描画のたびに最新を渡す。選択がなければ null を渡す(そのとき Esc は何もしない)。
 *   リスナーは1回だけ登録し、onClear は ref 経由で最新のものを呼ぶ(描画のたびの付け外しや、古い処理の呼び出しを避ける)。
 * - 入力中(テキスト入力・select など)とダイアログの中の Esc は、その操作に任せて何もしない(ownsEscapeKey)。
 *   子がすでに処理した(defaultPrevented)Esc も何もしない。チェックボックス・ボタンにフォーカスがあるときは解除する
 * - 1画面に複数の選択があるときは、それぞれが自分の onClear を持つ(Esc で、選択のあるものがすべて解除される)
 */
export function useEscapeToClear(onClear: (() => void) | null): void {
  const clearRef = useRef<(() => void) | null>(null)
  clearRef.current = onClear

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const clear = clearRef.current
      if (clear === null || ownsEscapeKey(event.target)) return
      clear()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
