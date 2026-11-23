import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { FilterToggleButton } from '../common/filter-toggle/FilterToggleButton'
import { countClosedWithBalance } from '../../domain/settlement-batch/settlementBatchStatus'
import { summarizeSettlementBatches } from '../../domain/settlement-batch/summarizeSettlementBatches'
import { countActiveConditions } from '../common/journal-filter/journalFilterModel'
import { useElementHeight } from '../common/sticky/useElementHeight'
import { SettleTab } from './SettleTab'
import { SplitHistoryTab } from './SplitHistoryTab'
import { SplitTab } from './SplitTab'
import { deriveSplitSettle, loadSplitSettleData, type SplitSettleData, type SplitSettleRepositories } from './splitSettleData'
import './SplitSettleScreen.css'

export type SplitSettleTab = 'split' | 'settle' | 'history'

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
  { key: 'history', label: '履歴' },
]

/**
 * 割勘・精算画面(計画Issue #153、承認済みモックアップ)。旧「割勘の対象選択」「割勘フォーム」
 * 「精算」「割勘履歴」の4画面を、「割勘」「精算」の2タブにまとめた1画面。割勘履歴は、割勘タブの最下部に埋もれないよう
 * 精算の右どなりの「履歴」タブに置く(計画Issue #268)。タブの切り替えではURLを変えず、データはこの画面で1回読み込んで
 * 各タブに渡す。書き込みのあとは読み直す。
 */
export function SplitSettleScreen({
  repositories,
  initialTab = 'split',
  today,
  initialCheckedEntryIds,
}: SplitSettleScreenProps) {
  const [tab, setTab] = useState<SplitSettleTab>(initialTab)
  /** 割勘タブの絞り込み条件と開閉。タブの行のボタンで開閉するため、ここで持ち、タブを行き来しても保つ(初期は閉、計画Issue #266) */
  const [filter, setFilter] = useState<JournalEntryFilter>({})
  const [filterOpen, setFilterOpen] = useState(false)
  /** 上部に固定するタブの行と、その高さ(絞り込み欄の top に使う、計画Issue #266) */
  const [tabbarElement, setTabbarElement] = useState<HTMLDivElement | null>(null)
  const tabbarHeight = useElementHeight(tabbarElement)
  const [data, setData] = useState<SplitSettleData | null>(null)

  const reload = async () => setData(await loadSplitSettleData(repositories))

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories])

  const derived = useMemo(() => (data === null ? null : deriveSplitSettle(data)), [data])
  // クローズ済みなのに残高があるバッチの数。精算タブの赤丸に出す(計画Issue #249)
  const closedWithBalance = useMemo(
    () =>
      data === null
        ? 0
        : countClosedWithBalance(
            summarizeSettlementBatches(
              data.batches,
              data.entries.flatMap((e) => e.lines),
              data.accounts,
            ),
          ),
    [data],
  )

  if (data === null || derived === null) return <p role="status">読み込み中...</p>

  const date = today ?? new Date().toISOString().slice(0, 10)

  return (
    <div className="split-settle" style={{ '--sticky-head-h': `${tabbarHeight}px` } as CSSProperties}>
      <h1 className="split-settle__title">割勘・精算</h1>
      <div className="split-settle__tabbar" ref={setTabbarElement}>
        <div role="tablist" aria-label="割勘・精算・履歴" className="split-settle__tabs">
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
              {item.key === 'settle' && closedWithBalance > 0 && (
                <span className="split-settle__dot" aria-label={`、精算済みなのに残高があるバッチが${closedWithBalance}件`}>
                  {closedWithBalance}
                </span>
              )}
            </button>
          ))}
        </div>
        {tab === 'split' && (
          <FilterToggleButton
            open={filterOpen}
            activeCount={countActiveConditions(filter)}
            onToggle={() => setFilterOpen((v) => !v)}
            controlsId="split-settle-filter"
          />
        )}
      </div>
      {tab === 'split' ? (
        <SplitTab
          data={data}
          derived={derived}
          repositories={repositories}
          today={date}
          onChanged={reload}
          initialCheckedEntryIds={initialCheckedEntryIds}
          filter={filter}
          onFilterChange={setFilter}
          filterOpen={filterOpen}
        />
      ) : tab === 'history' ? (
        <SplitHistoryTab data={data} repositories={repositories} onChanged={reload} />
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
