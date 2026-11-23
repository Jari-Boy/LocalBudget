import { useLayoutEffect, useState } from 'react'

/**
 * 要素の高さ(px)を測り、変わるたびに更新して返す(計画Issue #266)。上部に固定する要素(タブ・絞り込み欄)の
 * 高さを、その下に固定する要素(一括編集バー)の `top` に CSS 変数で渡すために使う。絞り込み欄の開閉などで
 * 高さが変わっても、下の固定要素が重ならないようにする。ResizeObserver が無い環境では 0 を返す。
 *
 * 要素は ref オブジェクトではなく state に入れた要素そのもの(コールバック ref: `ref={setElement}`)で受け取る。
 * 画面が読み込み中のあとに要素を描く場合、ref オブジェクトだと最初の一度しか測れず、要素が現れても測り直されないため。
 */
export function useElementHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    if (element === null) {
      // 要素が消えたら(絞り込み欄を閉じたときなど)、高さも0に戻す
      setHeight(0)
      return
    }
    if (typeof ResizeObserver === 'undefined') return
    const measure = () => setHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return height
}
