import { useLayoutEffect, useRef } from 'react'

/**
 * 一括編集バーの出入りで、表の行が画面上で動かないようにする(計画Issue #266)。
 * バーが出る・消えると、その下にある表の枠(スクロールできる枠)が、バーの高さの分だけ上下にずれる。
 * そのずれ(ページ上の枠の上端の変化)と同じだけ、枠の中のスクロール位置を動かして、行の画面上の位置を保つ。
 * 枠の中で動かせない分(スクロールの端まで来ている)は、ページのスクロールで補う。
 * バーの出入り(visible の変化)があった描画のときだけ動かす。ほかの理由での位置の変化(絞り込み欄の開閉など)には触れない。
 * ブラウザのスクロールアンカー(位置のずれを自動で補う機能)と二重にならないよう、
 * 使う画面のルートに `overflow-anchor: none` を付ける。
 */
export function useKeepRowsInPlace(visible: boolean, region: HTMLElement | null): void {
  const previous = useRef<{ visible: boolean; pageTop: number } | null>(null)

  useLayoutEffect(() => {
    if (region === null) return
    // ページの上端からの位置にする(ユーザーのスクロールで変わる画面上の位置と区別するため)
    const pageTop = region.getBoundingClientRect().top + window.scrollY
    const before = previous.current
    if (before !== null && before.visible !== visible) {
      const delta = pageTop - before.pageTop
      if (delta !== 0) {
        const scrollTop = region.scrollTop
        region.scrollTop = scrollTop + delta
        const rest = delta - (region.scrollTop - scrollTop)
        if (rest !== 0) window.scrollBy(0, rest)
      }
    }
    previous.current = { visible, pageTop }
  })
}

/**
 * useKeepRowsInPlace を呼ぶだけの、何も描画しないコンポーネント。呼び出す画面が、読み込み中などの早期 return のあとでしか
 * バーの出入りを判断できないとき(フックを早期 return の前に置けないとき)に、画面の中に置いて使う。
 */
export function KeepRowsInPlace({ visible, region }: { visible: boolean; region: HTMLElement | null }): null {
  useKeepRowsInPlace(visible, region)
  return null
}