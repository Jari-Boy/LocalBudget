import { useLayoutEffect, useRef } from 'react'

/**
 * 一括編集バーの出入りで、表の行が画面上で動かないようにする(計画Issue #266)。
 * バーが出る・消えると、その下にある表が、バーの高さの分だけ上下にずれる。そのずれ(ページ上の表の上端の変化)と
 * 同じだけページをスクロールして、行の画面上の位置を保つ。
 * バーの出入り(visible の変化)があった描画のときだけ動かす。ほかの理由での位置の変化(絞り込み欄の開閉など)には触れない。
 * ブラウザのスクロールアンカー(位置のずれを自動で補う機能)と二重にならないよう、
 * 使う画面のルートに `overflow-anchor: none` を付ける。
 */
export function useKeepRowsInPlace(visible: boolean, anchor: HTMLElement | null): void {
  const previous = useRef<{ visible: boolean; pageTop: number } | null>(null)

  useLayoutEffect(() => {
    if (anchor === null) return
    // ページの上端からの位置にする(ユーザーのスクロールで変わる画面上の位置と区別するため)
    const pageTop = anchor.getBoundingClientRect().top + window.scrollY
    const before = previous.current
    if (before !== null && before.visible !== visible) {
      const delta = pageTop - before.pageTop
      if (delta !== 0) window.scrollBy(0, delta)
    }
    previous.current = { visible, pageTop }
  })
}

/**
 * useKeepRowsInPlace を呼ぶだけの、何も描画しないコンポーネント。呼び出す画面が、読み込み中などの早期 return のあとでしか
 * バーの出入りを判断できないとき(フックを早期 return の前に置けないとき)に、画面の中に置いて使う。
 */
export function KeepRowsInPlace({ visible, anchor }: { visible: boolean; anchor: HTMLElement | null }): null {
  useKeepRowsInPlace(visible, anchor)
  return null
}
