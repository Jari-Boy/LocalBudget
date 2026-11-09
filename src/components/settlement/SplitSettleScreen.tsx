import { useEffect, useMemo, useState } from 'react'
import { SettleTab } from './SettleTab'
import { SplitTab } from './SplitTab'
import { deriveSplitSettle, loadSplitSettleData, type SplitSettleData, type SplitSettleRepositories } from './splitSettleData'
import './SplitSettleScreen.css'

export type SplitSettleTab = 'split' | 'settle'

export interface SplitSettleScreenProps {
  repositories: SplitSettleRepositories
  /** 最初に開くタブ。省略時は割勘 */
  initialTab?: SplitSettleTab
  /** 割勘仕訳・精算の取引日の既定値(YYYY-MM-DD)。省略時は本日 */
  today?: string
  /** 割勘タブで最初から選んだ状態にする仕訳(仕訳画面の「この仕訳を割勘」から来たとき) */
  initialCheckedEntryIds?: readonly number[]
}

const TABS: { key: SplitSettleTab; label: string }[] = [
  { key: 'split', label: '割勘' },
  { key: 'settle', label: '精算' },
]

/**
 * 割勘・精算画面(計画Issue #153、承認済みモックアップ)。旧「割勘の対象選択」「割勘フォーム」
 * 「精算」「割勘履歴」の4画面を、「割勘」「精算」の2タブにまとめた1画面。タブの切り替えでは
 * URLを変えず、データはこの画面で1回読み込んで両タブに渡す。書き込みのあとは読み直す。
 */
export function SplitSettleScreen({
  repositories,
  initialTab = 'split',
  today,
  initialCheckedEntryIds,
}: SplitSettleScreenProps) {
  const [tab, setTab] = useState<SplitSettleTab>(initialTab)
  const [data, setData] = useState<SplitSettleData | null>(null)

  const reload = async () => setData(await loadSplitSettleData(repositories))

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories])

  const derived = useMemo(() => (data === null ? null : deriveSplitSettle(data)), [data])

  if (data === null || derived === null) return <p role="status">読み込み中...</p>

  const date = today ?? new Date().toISOString().slice(0, 10)

  return (
    <div className="split-settle">
      <h1 className="split-settle__title">割勘・精算</h1>
      <div role="tablist" aria-label="割勘と精算" className="split-settle__tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`split-settle__tab${tab === item.key ? ' split-settle__tab--current' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'split' ? (
        <SplitTab
          data={data}
          derived={derived}
          repositories={repositories}
          today={date}
          onChanged={reload}
          initialCheckedEntryIds={initialCheckedEntryIds}
        />
      ) : (
        <SettleTab
          data={data}
          derived={derived}
          repositories={repositories}
          today={date}
          onChanged={reload}
        />
      )}
    </div>
  )
}
