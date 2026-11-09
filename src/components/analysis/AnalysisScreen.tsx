import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  resolveComparisonPeriod,
  resolvePresetPeriod,
  type AnalysisComparisonMode,
  type AnalysisPresetKey,
} from '../../domain/analysis/analysisPeriod'
import type { Period } from '../../domain/financial-statement/Period'
import { getFirstDayOfMonth } from '../../domain/financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../../domain/financial-statement/getLastDayOfMonth'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { buildCounterpartyTree, buildProjectTree } from '../master/masterTreeNodes'
import { AnalysisConditionBar, type AnalysisPeriodInput } from './AnalysisConditionBar'
import { StatementsTab } from './StatementsTab'
import { loadAnalysisData, type AnalysisData, type AnalysisRepositories } from './analysisData'
import { toJournalFilter, toStatementFilter, type AnalysisConditionValues } from './analysisConditionsModel'
import './AnalysisScreen.css'

export type AnalysisTab = 'statements' | 'charts' | 'budget'

export interface AnalysisScreenProps {
  repositories: AnalysisRepositories
  /** テスト用に「今日」を注入できるようにする(期間プリセットの基準)。省略時は実際の今日の日付 */
  today?: string
  /** 仕訳一覧へ移動する。期間と選んだ条件を引き継いだ検索条件を渡す */
  onOpenJournal: (filter: JournalEntryFilter) => void
}

const TABS: AnalysisTab[] = ['statements', 'charts', 'budget']
const DEFAULT_PRESET: AnalysisPresetKey = 'thisMonth'
/** 月の選択肢の下限: 最も古い仕訳の月、なければこの月数だけ前まで */
const MONTH_OPTIONS_BACK = 23

function toMonth(date: string): string {
  return date.slice(0, 7)
}

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
}

function monthFromIndex(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

function periodInputFor(preset: AnalysisPresetKey, today: string): AnalysisPeriodInput {
  const period = resolvePresetPeriod(preset, today)
  return {
    mode: 'month',
    preset,
    fromMonth: toMonth(period.from),
    toMonth: toMonth(period.to),
    fromDate: period.from,
    toDate: period.to,
  }
}

/** 入力から期間(開始日・終了日)を決める。月で指定したときは月初〜月末。 */
function resolvePeriod(input: AnalysisPeriodInput): Period {
  if (input.mode === 'date') return { from: input.fromDate, to: input.toDate }
  return {
    from: getFirstDayOfMonth(Number(input.fromMonth.slice(0, 4)), Number(input.fromMonth.slice(5, 7))),
    to: getLastDayOfMonth(Number(input.toMonth.slice(0, 4)), Number(input.toMonth.slice(5, 7))),
  }
}

/** 見出し用の期間の表記。同じ月は「2026年7月」、複数月は「2026年5月〜2026年7月」、日付指定は日付のまま。 */
function labelPeriod(period: Period, mode: 'month' | 'date'): string {
  if (mode === 'date') return period.from === period.to ? period.from : `${period.from}〜${period.to}`
  const month = (d: string) => `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月`
  return toMonth(period.from) === toMonth(period.to) ? month(period.from) : `${month(period.from)}〜${month(period.to)}`
}

const memberCategories = (members: readonly { id: number; name: string; isActive: boolean }[]): TreeSelectCategory[] => [
  {
    key: 'members',
    name: '',
    nodes: members.map((m) => ({ kind: 'item' as const, value: String(m.id), name: m.name, isActive: m.isActive })),
  },
]

/**
 * 分析画面(計画Issue #155)。サイドナビの「分析」に置き、財務諸表・グラフ分析・予算の3つのタブを
 * 持つ。条件(期間のプリセットと開始・終了、比較、世帯メンバー・プロジェクト・取引先)は上に置き、
 * 全タブで共通にする。BSの基準は期間の終了日。仕訳一覧へ移動するときは、期間と選んだ条件を
 * 引き継ぐ。旧の財務諸表画面(FinancialStatementScreen)を置き換えた。
 */
export function AnalysisScreen({ repositories, today, onOpenJournal }: AnalysisScreenProps) {
  const { t } = useTranslation('analysis')
  const todayDate = today ?? new Date().toISOString().slice(0, 10)

  const [data, setData] = useState<AnalysisData | null>(null)
  const [tab, setTab] = useState<AnalysisTab>('statements')
  const [periodInput, setPeriodInput] = useState<AnalysisPeriodInput>(() => periodInputFor(DEFAULT_PRESET, todayDate))
  const [comparison, setComparison] = useState<AnalysisComparisonMode>('none')
  const [values, setValues] = useState<AnalysisConditionValues>({ member: '', project: '', counterparty: '' })

  useEffect(() => {
    let cancelled = false
    void loadAnalysisData(repositories).then((loaded) => {
      if (!cancelled) setData(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [repositories])

  const period = useMemo(() => resolvePeriod(periodInput), [periodInput])
  const comparisonPeriod = useMemo(() => resolveComparisonPeriod(period, comparison), [period, comparison])

  const monthOptions = useMemo(() => {
    const current = monthIndex(toMonth(todayDate))
    const earliestEntry = data?.entries.reduce<string | null>(
      (min, e) => (min === null || e.entryDate < min ? e.entryDate : min),
      null,
    )
    const start = Math.min(earliestEntry ? monthIndex(toMonth(earliestEntry)) : current, current - MONTH_OPTIONS_BACK)
    const selected = [periodInput.fromMonth, periodInput.toMonth].map(monthIndex)
    const first = Math.min(start, ...selected)
    const last = Math.max(current, ...selected)
    return Array.from({ length: last - first + 1 }, (_, i) => monthFromIndex(first + i))
  }, [data, todayDate, periodInput.fromMonth, periodInput.toMonth])

  const statementFilter = useMemo(
    () =>
      data === null
        ? {}
        : toStatementFilter(values, {
            projects: data.projects,
            projectGroups: data.projectGroups,
            counterparties: data.counterparties,
            counterpartyGroups: data.counterpartyGroups,
          }),
    [data, values],
  )

  const categories = useMemo(() => {
    if (data === null) return null
    const inactive = (items: readonly { id: number; isActive: boolean }[]) =>
      new Set(items.filter((i) => !i.isActive).map((i) => i.id))
    return {
      member: memberCategories(data.members),
      project: buildTreeSelectCategories(
        buildProjectTree({ groups: data.projectGroups, projects: data.projects }),
        inactive(data.projects),
      ),
      counterparty: buildTreeSelectCategories(
        buildCounterpartyTree({
          groups: data.counterpartyGroups,
          counterparties: data.counterparties,
          accountNameById: new Map(),
          patternCountById: new Map(),
        }),
        inactive(data.counterparties),
      ),
    }
  }, [data])

  if (data === null || categories === null) return <p role="status">{t('loading')}</p>

  const changePeriod = (next: Partial<AnalysisPeriodInput>) => setPeriodInput((prev) => ({ ...prev, ...next }))

  const changeMode = (mode: 'month' | 'date') =>
    setPeriodInput((prev) => {
      if (mode === prev.mode) return prev
      if (mode === 'date') {
        const current = resolvePeriod(prev)
        return { ...prev, mode, fromDate: current.from, toDate: current.to }
      }
      return { ...prev, mode, fromMonth: toMonth(prev.fromDate), toMonth: toMonth(prev.toDate) }
    })

  const periodLabel = labelPeriod(period, periodInput.mode)
  const comparisonLabel = comparisonPeriod ? labelPeriod(comparisonPeriod, 'date') : ''

  return (
    <div className="analysis">
      <h1 className="analysis__title">{t('title')}</h1>

      <AnalysisConditionBar
        period={periodInput}
        onPeriodChange={changePeriod}
        onPresetPick={(key) => setPeriodInput(periodInputFor(key, todayDate))}
        onModeChange={changeMode}
        monthOptions={monthOptions}
        comparison={comparison}
        onComparisonChange={setComparison}
        values={values}
        onValuesChange={setValues}
        memberCategories={categories.member}
        projectCategories={categories.project}
        counterpartyCategories={categories.counterparty}
      />

      <div role="tablist" aria-label={t('tabsLabel')} className="analysis__tabs">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'analysis__tab analysis__tab--current' : 'analysis__tab'}
            onClick={() => setTab(key)}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'statements' && (
        <StatementsTab
          data={data}
          period={period}
          comparisonPeriod={comparisonPeriod}
          filter={statementFilter}
          periodLabel={periodLabel}
          comparisonLabel={comparisonLabel}
          onOpenAccount={(accountId) => onOpenJournal(toJournalFilter(period, values, { accountIds: [accountId] }))}
        />
      )}
    </div>
  )
}
