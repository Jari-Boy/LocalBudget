import { useLayoutEffect, useState, type ReactNode } from 'react'
import { useElementHeight } from './useElementHeight'
import './StickyToolbar.css'

export interface StickyToolbarProps {
  /** 行のクラス名(行の中身の並べ方・余白は、呼び出し側のクラスで決める) */
  className?: string
  children: ReactNode
}

/**
 * 一覧の上の検索・追加ボタンの行を、画面の上部(固定したタブの行の下)に固定する(計画Issue #266)。
 * 行の高さを、親(一覧の列)の CSS 変数 `--sticky-head-extra` に入れる。その下に固定する表の見出しの複製
 * (FloatingTableHeader)が、この行に重ならないようにするため。行の親は、表と並ぶ一覧の列(表の高さ全体を囲む要素)にすること。
 */
export function StickyToolbar({ className, children }: StickyToolbarProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const height = useElementHeight(element)

  useLayoutEffect(() => {
    const parent = element?.parentElement
    if (parent === null || parent === undefined) return
    parent.style.setProperty('--sticky-head-extra', `${height}px`)
    return () => {
      parent.style.removeProperty('--sticky-head-extra')
    }
  }, [element, height])

  return (
    <div ref={setElement} className={className === undefined ? 'sticky-toolbar' : `${className} sticky-toolbar`}>
      {children}
    </div>
  )
}