import type { KeyboardEvent } from 'react'
import { importTabPanelId, type ImportTabKey } from './importTabs'

/** タブ見出しに添える状態の札。todo=黄色(まだ確認・入力が要る)、error=赤(確定できなかった)、warning=黄色の警告 */
export interface ImportTabState {
  tone: 'todo' | 'error' | 'warning'
  text: string
}

export interface ImportTabItem {
  key: ImportTabKey
  label: string
  count: number
  /** 絞り込み中の、そのタブの全体の件数(計画Issue #258)。渡すと件数を「count / totalCount」で出す */
  totalCount?: number
  /** 確認が必要なタブにだけ付ける状態の札 */
  states?: readonly ImportTabState[]
  /** 確認不要のタブ。文字も数も灰色で、札は付けない */
  muted?: boolean
}

export interface ImportTabBarProps {
  /** タブ全体の名前(読み上げ用) */
  label: string
  tabs: readonly ImportTabItem[]
  active: ImportTabKey
  onSelect: (key: ImportTabKey) => void
}

/**
 * 明細取込画面の一覧のタブ見出し(計画Issue #263)。下線だけの軽いタブで、隣り合うタブの間に細い縦線を入れる。
 * 件数を常に出し、確認が必要なタブには枠線つきの札(黄色=未入力・似た取引、赤=要対応)を添える。確認不要のタブは
 * 灰色で札なし。ほかのタブの行は見えないので、札で確認の漏れに気づけるようにする。選択中のタブだけ Tab キーで止まり、
 * ← → で隣のタブ、Home・End で先頭・最後のタブを選べる(フォーカスも一緒に移る)。
 */
export function ImportTabBar({ label, tabs, active, onSelect }: ImportTabBarProps) {
  /** → ← は隣のタブ(端からは反対の端へ回る)、Home・End は先頭・最後のタブ。選ぶだけでなくフォーカスも移し、続けて押せるようにする */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = tabs[nextIndex]
    onSelect(next.key)
    document.getElementById(`import-tab-${next.key}`)?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className="import-tabs">
      {tabs.map((tab, index) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`import-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={importTabPanelId(tab.key)}
            tabIndex={selected ? 0 : -1}
            className={`import-tab${tab.muted ? ' import-tab--muted' : ''}`}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{tab.label}</span>
            <span className="import-tab__count">{tab.totalCount === undefined ? tab.count : `${tab.count} / ${tab.totalCount}`}</span>
            {tab.states?.map((state) => (
              <span key={state.text} className={`import-tab__state import-tab__state--${state.tone}`}>
                {state.text}
              </span>
            ))}
          </button>
        )
      })}
    </div>
  )
}
