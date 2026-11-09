import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  resolveTrendWindowMonths,
  type AnalysisComparisonMode,
} from '../../domain/analysis/analysisPeriod'
import {
  buildMonthlySummaries,
  OTHER_GROUP_KEY,
  resolveTopExpenseGroups,
} from '../../domain/analysis/buildMonthlySummaries'
import { listEquityChangeLines, listPeriodLines, type AnalysisLine } from '../../domain/analysis/listAnalysisLines'
import type { FinancialStatementFilter } from '../../domain/financial-statement/FinancialStatementFilter'
import type { Period } from '../../domain/financial-statement/Period'
import { generateFilteredBalanceSheet } from '../../domain/financial-statement/generateFilteredBalanceSheet'
import { generateFilteredProfitAndLoss } from '../../domain/financial-statement/generateFilteredProfitAndLoss'
import { getFirstDayOfMonth } from '../../domain/financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../../domain/financial-statement/getLastDayOfMonth'
import { Chart } from '../common/chart/Chart'
import { CHART_OTHER_COLOR, colorForSeries } from '../common/chart/chartPalette'
import type { AnalysisData } from './analysisData'
import { compactYen, signedYen, yen } from './analysisFormat'
import { AnalysisLineSections, TOOLTIP_LINE_COUNT, type AnalysisLineSection } from './AnalysisLineList'

export interface ChartsTabProps {
  data: AnalysisData
  period: Period
  comparisonPeriod: Period | null
  comparisonMode: AnalysisComparisonMode
  filter: FinancialStatementFilter
  /** 期間の見出し(例: 「2026年7月」) */
  periodLabel: string
  /** 内訳の行を押したときの移動(仕訳一覧へ、その日・科目・選んだ条件を引き継ぐ) */
  onOpenLine: (line: AnalysisLine) => void
}

/** 内訳の科目数の上限(超えた分は「その他」にまとめる) */
const BREAKDOWN_ITEM_COUNT = 7

function monthPeriod(month: string): Period {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return { from: getFirstDayOfMonth(year, monthNumber), to: getLastDayOfMonth(year, monthNumber) }
}

/** 横軸のラベル。最初の月と1月は年も添える(例: 「25年12月」)。 */
function axisLabel(month: string, index: number): string {
  const monthNumber = Number(month.slice(5, 7))
  return monthNumber === 1 || index === 0 ? `${month.slice(2, 4)}年${monthNumber}月` : `${monthNumber}月`
}

const longMonthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`

/**
 * 「グラフ分析」タブ(計画Issue #155)。要約の一文、主要な数字(収益・費用・収支・貯蓄率・期末の純資産)、
 * 月次の収益と費用、純資産の推移、費用の内訳、グループ別の費用の推移、月次の数値の表を出す。
 * 推移のグラフは、期間が12か月未満でも直近12か月を出し、選んだ期間を帯で示す。グラフにカーソルを
 * 合わせると対象の仕訳行を金額順に上位5行出し、クリックで全行を固定表示する(合計はグラフの金額と
 * 一致)。固定表示の行から、仕訳一覧へ移動できる。
 */
export function ChartsTab({
  data,
  period,
  comparisonPeriod,
  comparisonMode,
  filter,
  periodLabel,
  onOpenLine,
}: ChartsTabProps) {
  const { t } = useTranslation('analysis')
  const { entries, accounts } = data

  const topGroups = useMemo(() => resolveTopExpenseGroups(data.accountGroups, accounts), [data.accountGroups, accounts])
  const windowMonths = useMemo(() => resolveTrendWindowMonths(period), [period])
  const summaries = useMemo(
    () => buildMonthlySummaries(entries, accounts, windowMonths, filter, topGroups),
    [entries, accounts, windowMonths, filter, topGroups],
  )
  const categories = windowMonths.map(axisLabel)
  const rangeStart = Math.max(windowMonths.indexOf(period.from.slice(0, 7)), 0)
  const rangeEnd = Math.max(windowMonths.indexOf(period.to.slice(0, 7)), rangeStart)

  const current = useMemo(() => {
    const pl = generateFilteredProfitAndLoss(entries, accounts, period.from, period.to, filter)
    const equity = generateFilteredBalanceSheet(entries, accounts, period.to, filter).totalEquity
    return { pl, equity }
  }, [entries, accounts, period, filter])
  const compare = useMemo(() => {
    if (!comparisonPeriod) return null
    return {
      pl: generateFilteredProfitAndLoss(entries, accounts, comparisonPeriod.from, comparisonPeriod.to, filter),
      equity: generateFilteredBalanceSheet(entries, accounts, comparisonPeriod.to, filter).totalEquity,
    }
  }, [entries, accounts, comparisonPeriod, filter])

  const { pl } = current
  const compareName = comparisonMode === 'previousYear' ? t('charts.compare.previousYear') : t('charts.compare.previousPeriod')
  const delta = (now: number, before: number | undefined) => {
    if (comparisonMode === 'none') return ' '
    if (before === undefined) return t('charts.compare.none')
    return `${compareName} ${signedYen(now - before)}`
  }
  const kpis = [
    { key: 'revenue', label: t('charts.kpi.revenue'), value: yen(pl.totalRevenue), delta: delta(pl.totalRevenue, compare?.pl.totalRevenue) },
    { key: 'expense', label: t('charts.kpi.expense'), value: yen(pl.totalExpense), delta: delta(pl.totalExpense, compare?.pl.totalExpense) },
    { key: 'net', label: t('charts.kpi.net'), value: signedYen(pl.netIncome), delta: delta(pl.netIncome, compare?.pl.netIncome) },
    {
      key: 'rate',
      label: t('charts.kpi.savingsRate'),
      value: pl.totalRevenue ? `${Math.round((pl.netIncome / pl.totalRevenue) * 100)}%` : '-',
      delta: t('charts.kpi.savingsRateNote'),
    },
    { key: 'equity', label: t('charts.kpi.equity'), value: yen(current.equity), delta: delta(current.equity, compare?.equity) },
  ]

  const expenseItems = [...pl.expenses].filter((e) => e.amount > 0).sort((a, b) => b.amount - a.amount)
  const insight =
    pl.totalExpense > 0 && expenseItems.length > 0
      ? t('charts.insight', {
          period: periodLabel,
          net: signedYen(pl.netIncome),
          name: expenseItems[0].accountName,
          share: Math.round((expenseItems[0].amount / pl.totalExpense) * 100),
          equity: yen(current.equity),
        })
      : ''

  // ---- 内訳の仕訳行(ホバー・クリックのときだけ計算する) ----
  const expenseAccountIdsOfGroup = (groupKey: string) =>
    accounts
      .filter((a) => a.category === 'expense')
      .filter((a) => {
        const groupId = topGroups.groupIdByAccountId.get(a.id)
        return groupKey === OTHER_GROUP_KEY ? groupId === undefined : groupId === Number(groupKey)
      })
      .map((a) => a.id)

  const flowSections = (index: number): AnalysisLineSection[] => {
    const month = monthPeriod(windowMonths[index])
    return [
      { key: 'revenue', name: t('charts.flow.revenue'), lines: listPeriodLines(entries, accounts, month, filter, { categories: ['revenue'] }) },
      { key: 'expense', name: t('charts.flow.expense'), lines: listPeriodLines(entries, accounts, month, filter, { categories: ['expense'] }) },
    ]
  }
  const equitySections = (index: number): AnalysisLineSection[] => [
    {
      key: 'equity',
      name: t('charts.equityTrend.change'),
      signed: true,
      lines: listEquityChangeLines(entries, accounts, monthPeriod(windowMonths[index]), filter),
    },
  ]

  const stackSeries = [
    ...topGroups.series.map((g, i) => ({ key: String(g.groupId), name: g.name, color: colorForSeries(i) })),
    { key: OTHER_GROUP_KEY, name: t('charts.stack.other'), color: CHART_OTHER_COLOR },
  ].filter((s) => summaries.some((m) => (m.expenseByGroup[s.key] ?? 0) > 0))
  const stackSections = (index: number): AnalysisLineSection[] =>
    stackSeries
      .filter((s) => (summaries[index].expenseByGroup[s.key] ?? 0) > 0)
      .map((s) => ({
        key: s.key,
        name: s.name,
        lines: listPeriodLines(entries, accounts, monthPeriod(windowMonths[index]), filter, {
          accountIds: expenseAccountIdsOfGroup(s.key),
        }),
      }))

  const tooltipOf = (sections: AnalysisLineSection[]) => <AnalysisLineSections sections={sections} limit={TOOLTIP_LINE_COUNT} />
  const detailOf = (sections: AnalysisLineSection[]) => <AnalysisLineSections sections={sections} onOpenLine={onOpenLine} />
  const highlight = [rangeStart, rangeEnd] as const

  return (
    <div className="analysis__charts">
      {insight && <p className="analysis__insight">{insight}</p>}

      <div className="analysis__kpis">
        {kpis.map((k) => (
          <div key={k.key} className="analysis__kpi">
            <div className="analysis__kpi-label">{k.label}</div>
            <div className="analysis__kpi-value">{k.value}</div>
            <div className="analysis__kpi-delta">{k.delta}</div>
          </div>
        ))}
      </div>

      <div className="analysis__chart-row">
        <Chart
          type="bar"
          title={t('charts.flow.title')}
          categories={categories}
          series={[
            { key: 'revenue', name: t('charts.flow.revenue'), values: summaries.map((m) => m.revenue) },
            { key: 'expense', name: t('charts.flow.expense'), values: summaries.map((m) => m.expense) },
          ]}
          formatValue={yen}
          formatAxis={compactYen}
          summary={t('charts.flow.summary')}
          highlightRange={highlight}
          renderTooltipExtra={(i) => tooltipOf(flowSections(i))}
          renderDetail={(i) => detailOf(flowSections(i))}
          showTable={false}
        />
        <Chart
          type="line"
          title={t('charts.equityTrend.title')}
          categories={categories}
          series={[{ key: 'equity', name: t('charts.equityTrend.series'), values: summaries.map((m) => m.equity) }]}
          formatValue={yen}
          formatAxis={compactYen}
          summary={t('charts.equityTrend.summary')}
          highlightRange={highlight}
          renderTooltipExtra={(i) => tooltipOf(equitySections(i))}
          renderDetail={(i) => detailOf(equitySections(i))}
          showTable={false}
        />
      </div>

      <div className="analysis__chart-row">
        <ExpenseBreakdown
          data={data}
          period={period}
          filter={filter}
          periodLabel={periodLabel}
          items={expenseItems}
          total={pl.totalExpense}
          onOpenLine={onOpenLine}
        />
        {stackSeries.length > 0 && (
          <Chart
            type="stacked"
            title={t('charts.stack.title')}
            categories={categories}
            series={stackSeries.map((s) => ({
              key: s.key,
              name: s.name,
              color: s.color,
              values: summaries.map((m) => m.expenseByGroup[s.key] ?? 0),
            }))}
            formatValue={yen}
            formatAxis={compactYen}
            summary={t('charts.stack.summary')}
            highlightRange={highlight}
            renderTooltipExtra={(i) => tooltipOf(stackSections(i))}
            renderDetail={(i) => detailOf(stackSections(i))}
            showTable={false}
          />
        )}
      </div>

      <details className="analysis__card analysis__details">
        <summary>{t('charts.table.summary')}</summary>
        <div className="analysis__table-scroll">
          <table className="analysis__table">
            <thead>
              <tr>
                <th>{t('charts.table.month')}</th>
                <th className="analysis__num">{t('charts.kpi.revenue')}</th>
                <th className="analysis__num">{t('charts.kpi.expense')}</th>
                <th className="analysis__num">{t('charts.kpi.net')}</th>
                <th className="analysis__num">{t('charts.equityTrend.series')}</th>
                {stackSeries.map((s) => (
                  <th key={s.key} className="analysis__num">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries.map((m) => (
                <tr key={m.month}>
                  <td className="analysis__nowrap">{longMonthLabel(m.month)}</td>
                  <td className="analysis__num">{yen(m.revenue)}</td>
                  <td className="analysis__num">{yen(m.expense)}</td>
                  <td className="analysis__num">{signedYen(m.net)}</td>
                  <td className="analysis__num">{yen(m.equity)}</td>
                  {stackSeries.map((s) => (
                    <td key={s.key} className="analysis__num">
                      {yen(m.expenseByGroup[s.key] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

interface ExpenseBreakdownProps {
  data: AnalysisData
  period: Period
  filter: FinancialStatementFilter
  periodLabel: string
  items: readonly { accountId: number; accountName: string; amount: number }[]
  total: number
  onOpenLine: (line: AnalysisLine) => void
}

/**
 * 「費用の内訳」。期間の費用を科目別に金額の大きい順に並べ(上位7科目、残りは「その他」)、
 * 横棒と割合を出す。行にカーソルを合わせると仕訳行の上位、押すと全行を固定表示する。
 */
function ExpenseBreakdown({ data, period, filter, periodLabel, items, total, onOpenLine }: ExpenseBreakdownProps) {
  const { t } = useTranslation('analysis')
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

  const top = items.slice(0, BREAKDOWN_ITEM_COUNT)
  const rest = items.slice(BREAKDOWN_ITEM_COUNT)
  const rows = [
    ...top.map((i) => ({ key: String(i.accountId), name: i.accountName, amount: i.amount, accountIds: [i.accountId] })),
    ...(rest.length > 0
      ? [{ key: 'other', name: t('charts.breakdown.other'), amount: rest.reduce((s, i) => s + i.amount, 0), accountIds: rest.map((i) => i.accountId) }]
      : []),
  ]
  const max = rows[0]?.amount ?? 1

  const sectionOf = (row: (typeof rows)[number]): AnalysisLineSection[] => [
    {
      key: row.key,
      name: row.name,
      lines: listPeriodLines(data.entries, data.accounts, period, filter, { accountIds: row.accountIds }),
    },
  ]
  const hoveredRow = rows.find((r) => r.key === hovered)
  const pinnedRow = rows.find((r) => r.key === pinned)

  return (
    <section className="analysis__card" aria-label={t('charts.breakdown.title')}>
      <div className="analysis__card-head">
        <h2 className="analysis__card-title">{t('charts.breakdown.title')}</h2>
        <span className="analysis__card-note">{periodLabel}</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="analysis__breakdown-item">
          <button
            type="button"
            className="analysis__breakdown-row"
            aria-label={t('charts.breakdown.label', { name: row.name, amount: yen(row.amount) })}
            aria-pressed={pinned === row.key}
            onMouseEnter={() => setHovered(row.key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(row.key)}
            onBlur={() => setHovered(null)}
            onClick={() => setPinned((current) => (current === row.key ? null : row.key))}
          >
            <span data-testid="analysis-breakdown-name">{row.name}</span>
            <span className="analysis__breakdown-track">
              <span className="analysis__breakdown-bar" style={{ width: `${(row.amount / max) * 100}%` }} />
            </span>
            <span className="analysis__num">{yen(row.amount)}</span>
            <span className="analysis__num analysis__num--muted">{Math.round((row.amount / total) * 100)}%</span>
          </button>
        </div>
      ))}
      {hoveredRow && (
        <div role="tooltip" className="analysis__breakdown-tip">
          <AnalysisLineSections sections={sectionOf(hoveredRow)} limit={TOOLTIP_LINE_COUNT} />
        </div>
      )}
      {pinnedRow && (
        <div className="analysis__pinned">
          <div className="analysis__pinned-head">
            <span className="analysis__pinned-title">
              {t('charts.lines.titleWithCount', {
                title: `${periodLabel} ${pinnedRow.name}`,
                count: sectionOf(pinnedRow)[0].lines.length,
              })}
            </span>
            <button type="button" className="analysis__close" aria-label={t('charts.lines.close')} onClick={() => setPinned(null)}>
              ×
            </button>
          </div>
          <AnalysisLineSections sections={sectionOf(pinnedRow)} onOpenLine={onOpenLine} />
        </div>
      )}
    </section>
  )
}
