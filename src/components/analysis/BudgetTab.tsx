import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveTrendWindowMonths } from '../../domain/analysis/analysisPeriod'
import { listPeriodLines, type AnalysisLine } from '../../domain/analysis/listAnalysisLines'
import { buildAccountGroupForest, type AccountGroupForestNode } from '../../domain/account-group/buildAccountGroupForest'
import { planBudgetCopy, summarizeBudgetProgress } from '../../domain/budget/summarizeBudgetProgress'
import type { Period } from '../../domain/financial-statement/Period'
import { getFirstDayOfMonth } from '../../domain/financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../../domain/financial-statement/getLastDayOfMonth'
import { Chart } from '../common/chart/Chart'
import { CHART_OTHER_COLOR, colorForSeries } from '../common/chart/chartPalette'
import type { AnalysisData, AnalysisRepositories } from './analysisData'
import { compactYen, signedYen, yen } from './analysisFormat'
import { AnalysisLineSections, TOOLTIP_LINE_COUNT, type AnalysisLineSection } from './AnalysisLineList'

export interface BudgetTabProps {
  data: AnalysisData
  /** 期間(終了月の予算を表示し、推移のグラフの表示範囲に使う) */
  period: Period
  budgetRepository: AnalysisRepositories['budgetRepository']
  /** 予算を変更したあと、画面のデータを読み直す */
  onChanged: () => Promise<void> | void
  onOpenAccount: (accountId: number, month: Period) => void
  onOpenLine: (line: AnalysisLine) => void
}

interface BudgetDisplayRow {
  key: string
  kind: 'group' | 'account'
  accountId?: number
  groupId?: number
  name: string
  depth: number
  budget: number | null
  actual: number
  isCollapsed: boolean
}

function monthPeriod(month: string): Period {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return { from: getFirstDayOfMonth(year, monthNumber), to: getLastDayOfMonth(year, monthNumber) }
}

function previousMonthOf(month: string): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 2
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`
const axisLabel = (month: string, index: number) =>
  Number(month.slice(5, 7)) === 1 || index === 0 ? `${month.slice(2, 4)}年${Number(month.slice(5, 7))}月` : `${Number(month.slice(5, 7))}月`

/**
 * 予算の入力欄の文字列を金額にする。全角数字は半角に、桁区切りのカンマと空白は取り除く。
 * 空欄はnull(削除)、0以上の整数以外はundefined(無効)を返す。
 */
function parseBudgetInput(text: string): number | null | undefined {
  const normalized = text.normalize('NFKC').replace(/[,\s]/g, '')
  if (normalized === '') return null
  return /^\d+$/.test(normalized) ? Number(normalized) : undefined
}

/**
 * 「予算」タブ(計画Issue #155、旧計画Issue #35)。期間の終了月の予算を、費用の科目をマスタの
 * グループで階層表示して設定し、実績と比べる。予算は月と科目の単位で、グループの行は配下の合計を
 * 表示するだけ(グループ単位の予算は作らない)。入力を空にするとその月のその科目の予算を削除する。
 * 超過は色だけでなく文字(「✕ 超過」)でも示す。「先月の内容をコピー」は、対象月にすでにある予算を
 * 上書きしない。世帯メンバーなどの絞り込みは適用しない(docs/domain/budgets.md 1.4)。
 */
export function BudgetTab({ data, period, budgetRepository, onChanged, onOpenAccount, onOpenLine }: BudgetTabProps) {
  const { t } = useTranslation('analysis')
  const month = period.to.slice(0, 7)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [message, setMessage] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const [copying, setCopying] = useState(false)
  /** コピーの実行中(連打で2回目が走らないよう、描画を待たずに同期で判定する) */
  const copyingRef = useRef(false)

  const summary = useMemo(
    () => summarizeBudgetProgress(data.budgets, data.accounts, data.entries, month),
    [data.budgets, data.accounts, data.entries, month],
  )
  const progressByAccount = useMemo(() => new Map(summary.rows.map((r) => [r.accountId, r])), [summary])

  const rows = useMemo(() => {
    const expenseAccounts = data.accounts.filter((a) => a.category === 'expense' && progressByAccount.has(a.id))
    const groups = data.accountGroups.filter((g) => g.category === 'expense')
    const roots: AccountGroupForestNode[] = [
      ...buildAccountGroupForest(groups, expenseAccounts),
      ...expenseAccounts
        .filter((a) => a.accountGroupId === null)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((account): AccountGroupForestNode => ({ kind: 'account', account })),
    ]
    const leaves = (node: AccountGroupForestNode): number[] =>
      node.kind === 'account' ? [node.account.id] : node.children.flatMap(leaves)
    const walk = (nodes: readonly AccountGroupForestNode[], depth: number): BudgetDisplayRow[] =>
      nodes.flatMap((node): BudgetDisplayRow[] => {
        const ids = leaves(node)
        if (ids.length === 0) return []
        const progress = ids.map((id) => progressByAccount.get(id)!)
        const actual = progress.reduce((sum, p) => sum + p.actual, 0)
        const hasBudget = progress.some((p) => p.budget !== null)
        const budget = hasBudget ? progress.reduce((sum, p) => sum + (p.budget ?? 0), 0) : null
        if (node.kind === 'account') {
          return [{ key: `a${node.account.id}`, kind: 'account', accountId: node.account.id, name: node.account.name, depth, budget, actual, isCollapsed: false }]
        }
        const isCollapsed = collapsed.has(node.group.id)
        return [
          { key: `g${node.group.id}`, kind: 'group', groupId: node.group.id, name: node.group.name, depth, budget, actual, isCollapsed },
          ...(isCollapsed ? [] : walk(node.children, depth + 1)),
        ]
      })
    return walk(roots, 0)
  }, [data.accounts, data.accountGroups, progressByAccount, collapsed])

  const toggleGroup = (groupId: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })

  // ---- 予算の入力 ----
  const commit = async (accountId: number, text: string) => {
    const amount = parseBudgetInput(text)
    const existing = data.budgets.find((b) => b.accountId === accountId && b.yearMonth === month)
    if (amount === undefined) {
      // 入力は戻さず、直せるようにする
      setMessage(t('budget.invalidInput'))
      return
    }
    setDrafts((prev) => {
      const { [accountId]: _discarded, ...rest } = prev
      return rest
    })
    try {
      if (amount === null) {
        if (existing) await budgetRepository.delete(existing.id)
      } else if (existing) {
        if (existing.amount !== amount) await budgetRepository.update(existing.id, { amount })
      } else {
        await budgetRepository.create({ accountId, yearMonth: month, amount })
      }
      setMessage('')
      await onChanged()
    } catch {
      setMessage(t('budget.saveFailed'))
    }
  }

  const copyPrevious = async () => {
    if (copyingRef.current) return
    copyingRef.current = true
    setCopying(true)
    try {
      await runCopy()
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }

  const runCopy = async () => {
    const previousMonth = previousMonthOf(month)
    const previous = data.budgets.filter((b) => b.yearMonth === previousMonth)
    if (previous.length === 0) {
      setMessage(t('budget.noPrevious'))
      return
    }
    const plan = planBudgetCopy(
      previous,
      data.budgets.filter((b) => b.yearMonth === month),
      month,
    )
    try {
      for (const input of plan.toCreate) await budgetRepository.create(input)
      setMessage(
        plan.toCreate.length === 0
          ? t('budget.nothingToCopy')
          : plan.skippedCount > 0
            ? t('budget.copiedWithSkipped', { count: plan.toCreate.length, skipped: plan.skippedCount })
            : t('budget.copied', { count: plan.toCreate.length }),
      )
      await onChanged()
    } catch {
      setMessage(t('budget.saveFailed'))
    }
  }

  // ---- 主要な数字 ----
  const { totals } = summary
  const accountNameById = new Map(data.accounts.map((a) => [a.id, a.name]))
  const unbudgetedNames = summary.rows
    .filter((r) => r.budget === null && r.actual !== 0)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 2)
    .map((r) => accountNameById.get(r.accountId) ?? '')
  const kpis = [
    { key: 'budget', label: t('budget.kpi.budget'), value: yen(totals.budget), note: monthLabel(month) },
    {
      key: 'actual',
      label: t('budget.kpi.actual'),
      value: yen(totals.budgetedActual),
      note: totals.budget ? t('budget.kpi.consumed', { percent: Math.round((totals.budgetedActual / totals.budget) * 100) }) : t('budget.kpi.notSet'),
    },
    {
      key: 'remaining',
      label: t('budget.kpi.remaining'),
      value: signedYen(totals.remaining),
      note: totals.remaining < 0 ? t('budget.kpi.over') : t('budget.kpi.within'),
    },
    {
      key: 'unbudgeted',
      label: t('budget.kpi.unbudgeted'),
      value: yen(totals.unbudgetedActual),
      note: unbudgetedNames.length > 0 ? t('budget.kpi.unbudgetedNote', { names: unbudgetedNames.join('・') }) : ' ',
    },
  ]

  // ---- 予算と実績の推移 ----
  const windowMonths = useMemo(() => resolveTrendWindowMonths(period), [period])
  const monthlySummaries = useMemo(
    () => windowMonths.map((m) => summarizeBudgetProgress(data.budgets, data.accounts, data.entries, m)),
    [windowMonths, data.budgets, data.accounts, data.entries],
  )
  const budgetedLines = (index: number): AnalysisLineSection[] => {
    const m = windowMonths[index]
    const accountIds = monthlySummaries[index].rows.filter((r) => r.budget !== null).map((r) => r.accountId)
    return [
      {
        key: 'actual',
        name: t('budget.chart.actualOfBudgeted'),
        lines: listPeriodLines(data.entries, data.accounts, monthPeriod(m), {}, { accountIds }),
      },
    ]
  }
  const rangeStart = Math.max(windowMonths.indexOf(period.from.slice(0, 7)), 0)
  const rangeEnd = Math.max(windowMonths.indexOf(month), rangeStart)

  const meterOf = (budget: number | null, actual: number) => {
    if (budget === null) return { pct: 0, status: t('budget.status.unset'), over: false, unset: true, remaining: null as number | null }
    const ratio = budget ? actual / budget : actual > 0 ? 2 : 0
    const over = actual > budget
    return {
      pct: Math.min(Math.max(ratio, 0) * 100, 100),
      status: over ? t('budget.status.over') : `${Math.round(Math.max(ratio, 0) * 100)}%`,
      over,
      unset: false,
      remaining: budget - actual,
    }
  }

  return (
    <div className="analysis__charts">
      <div className="analysis__budget-head">
        <p className="analysis__budget-note">{t('budget.note', { month: monthLabel(month) })}</p>
        <div className="analysis__budget-actions">
          <span role="status" className="analysis__budget-message">
            {message}
          </span>
          <button type="button" className="analysis__button" disabled={copying} onClick={() => void copyPrevious()}>
            {t('budget.copyPrevious')}
          </button>
        </div>
      </div>

      <div className="analysis__kpis">
        {kpis.map((k) => (
          <div key={k.key} className="analysis__kpi">
            <div className="analysis__kpi-label">{k.label}</div>
            <div className="analysis__kpi-value">{k.value}</div>
            <div className="analysis__kpi-delta">{k.note}</div>
          </div>
        ))}
      </div>

      <section className="analysis__card" aria-label={t('budget.tableLabel')}>
        <h2 className="analysis__card-title">{t('budget.sectionTitle', { month: monthLabel(month) })}</h2>
        <table className="analysis__table">
          <thead>
            <tr>
              <th>{t('budget.columns.account')}</th>
              <th className="analysis__num analysis__col-budget">{t('budget.columns.budget')}</th>
              <th className="analysis__num">{t('budget.columns.actual')}</th>
              <th className="analysis__num">{t('budget.columns.remaining')}</th>
              <th className="analysis__col-meter">{t('budget.columns.consumed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meter = meterOf(r.budget, r.actual)
              return (
                <tr key={r.key}>
                  <td className={r.kind === 'group' ? 'analysis__cell--group' : undefined}>
                    <div className="analysis__name" style={{ paddingLeft: r.depth * 16 }}>
                      {r.kind === 'group' ? (
                        <>
                          <button
                            type="button"
                            className="analysis__toggle"
                            aria-expanded={!r.isCollapsed}
                            aria-label={t('statements.toggleGroup', { name: r.name })}
                            onClick={() => toggleGroup(r.groupId!)}
                          >
                            {r.isCollapsed ? '▸' : '▾'}
                          </button>
                          <span>{r.name}</span>
                        </>
                      ) : (
                        <button type="button" className="analysis__link" onClick={() => onOpenAccount(r.accountId!, monthPeriod(month))}>
                          {r.name}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="analysis__num">
                    {r.kind === 'account' ? (
                      <input
                        className="analysis__control analysis__budget-input"
                        inputMode="numeric"
                        aria-label={t('budget.inputLabel', { name: r.name })}
                        placeholder={t('budget.placeholder')}
                        value={drafts[r.accountId!] ?? (r.budget === null ? '' : String(r.budget))}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [r.accountId!]: e.target.value }))}
                        onBlur={(e) => void commit(r.accountId!, e.target.value)}
                      />
                    ) : r.budget === null ? (
                      '-'
                    ) : (
                      yen(r.budget)
                    )}
                  </td>
                  <td className="analysis__num">{yen(r.actual)}</td>
                  <td className="analysis__num">{meter.remaining === null ? '-' : signedYen(meter.remaining)}</td>
                  <td>
                    <div className="analysis__meter">
                      <div
                        className={
                          meter.over
                            ? 'analysis__meter-track analysis__meter-track--over'
                            : meter.unset
                              ? 'analysis__meter-track analysis__meter-track--unset'
                              : 'analysis__meter-track'
                        }
                      >
                        <div
                          className={meter.over ? 'analysis__meter-fill analysis__meter-fill--over' : 'analysis__meter-fill'}
                          style={{ width: `${meter.pct}%` }}
                        />
                      </div>
                      <span className={meter.over ? 'analysis__meter-status analysis__meter-status--over' : 'analysis__meter-status'}>
                        {meter.status}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <div className="analysis__chart-row">
        <Chart
          type="bar"
          title={t('budget.chart.title')}
          categories={windowMonths.map(axisLabel)}
          series={[
            { key: 'budget', name: t('budget.chart.budget'), color: CHART_OTHER_COLOR, values: monthlySummaries.map((s) => s.totals.budget) },
            { key: 'actual', name: t('budget.chart.actual'), color: colorForSeries(0), values: monthlySummaries.map((s) => s.totals.budgetedActual) },
          ]}
          formatValue={yen}
          formatAxis={compactYen}
          summary={t('budget.chart.summary')}
          highlightRange={[rangeStart, rangeEnd]}
          renderTooltipExtra={(i) => <AnalysisLineSections sections={budgetedLines(i)} limit={TOOLTIP_LINE_COUNT} />}
          renderDetail={(i) => <AnalysisLineSections sections={budgetedLines(i)} onOpenLine={onOpenLine} />}
        />
      </div>
    </div>
  )
}
