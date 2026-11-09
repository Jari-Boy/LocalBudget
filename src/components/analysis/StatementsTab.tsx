import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountCategory } from '../../domain/account/Account'
import { buildStatementRows, type StatementRow } from '../../domain/analysis/buildStatementRows'
import type { FinancialStatementFilter } from '../../domain/financial-statement/FinancialStatementFilter'
import type { Period } from '../../domain/financial-statement/Period'
import { generateFilteredBalanceSheet } from '../../domain/financial-statement/generateFilteredBalanceSheet'
import { generateFilteredProfitAndLoss } from '../../domain/financial-statement/generateFilteredProfitAndLoss'
import type { AnalysisData } from './analysisData'
import { signedYen, yen } from './analysisFormat'

export interface StatementsTabProps {
  data: AnalysisData
  period: Period
  comparisonPeriod: Period | null
  filter: FinancialStatementFilter
  /** 期間の見出し(例: 「2026年7月」「2026年5月〜2026年7月」) */
  periodLabel: string
  comparisonLabel: string
  onOpenAccount: (accountId: number) => void
}

interface DisplayRow {
  key: string
  name: string
  depth: number
  current: number
  compare: number | null
  difference: number | null
  /** 合計の行 */
  isSummary?: boolean
  /** 符号つきで表示する(当期純利益など) */
  signed?: boolean
  row?: StatementRow
}

const summary = (key: string, name: string, current: number, compare: number | null, signed = false): DisplayRow => ({
  key,
  name,
  depth: 0,
  current,
  compare,
  difference: compare === null ? null : current - compare,
  isSummary: true,
  signed,
})

/**
 * 「財務諸表」タブ(計画Issue #155)。PLとBSを並べ、マスタの科目グループで階層表示して折りたためる。
 * 比較があれば比較列と差額列を出す。BSの基準は期間の終了日(比較は比較期間の終了日)。
 * 純資産は、初期残高(純資産の科目)と損益の累計に分けて出し、貸借の一致を表示する。
 */
export function StatementsTab({
  data,
  period,
  comparisonPeriod,
  filter,
  periodLabel,
  comparisonLabel,
  onOpenAccount,
}: StatementsTabProps) {
  const { t } = useTranslation('analysis')
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const toggle = (groupId: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })

  const statements = useMemo(() => {
    const pl = generateFilteredProfitAndLoss(data.entries, data.accounts, period.from, period.to, filter)
    const plCompare = comparisonPeriod
      ? generateFilteredProfitAndLoss(data.entries, data.accounts, comparisonPeriod.from, comparisonPeriod.to, filter)
      : null
    const bs = generateFilteredBalanceSheet(data.entries, data.accounts, period.to, filter)
    const bsCompare = comparisonPeriod
      ? generateFilteredBalanceSheet(data.entries, data.accounts, comparisonPeriod.to, filter)
      : null
    return { pl, plCompare, bs, bsCompare }
  }, [data, period, comparisonPeriod, filter])

  const rowsFor = (
    category: AccountCategory,
    current: readonly { accountId: number; accountName: string; amount: number }[],
    compare: readonly { accountId: number; accountName: string; amount: number }[] | null,
  ): DisplayRow[] =>
    buildStatementRows({
      accounts: data.accounts.filter((a) => a.category === category),
      groups: data.accountGroups.filter((g) => g.category === category),
      current,
      comparison: compare,
      collapsedGroupIds: collapsed,
    }).map((row) => ({
      key: `${row.kind}:${row.groupId ?? row.accountId}`,
      name: row.name,
      depth: row.depth,
      current: row.current,
      compare: row.compare,
      difference: row.difference,
      row,
    }))

  const { pl, plCompare, bs, bsCompare } = statements
  const plRows: DisplayRow[] = [
    ...rowsFor('revenue', pl.revenues, plCompare?.revenues ?? null),
    summary('revenue-total', t('statements.revenueTotal'), pl.totalRevenue, plCompare?.totalRevenue ?? null),
    ...rowsFor('expense', pl.expenses, plCompare?.expenses ?? null),
    summary('expense-total', t('statements.expenseTotal'), pl.totalExpense, plCompare?.totalExpense ?? null),
    summary('net-income', t('statements.netIncome'), pl.netIncome, plCompare?.netIncome ?? null, true),
  ]
  const hasComparison = comparisonPeriod !== null
  const liabilitiesAndEquity = bs.totalLiabilities + bs.totalEquity
  const bsRows: DisplayRow[] = [
    ...rowsFor('asset', bs.assets, bsCompare?.assets ?? null),
    summary('asset-total', t('statements.assetTotal'), bs.totalAssets, bsCompare?.totalAssets ?? null),
    ...rowsFor('liability', bs.liabilities, bsCompare?.liabilities ?? null),
    summary('liability-total', t('statements.liabilityTotal'), bs.totalLiabilities, bsCompare?.totalLiabilities ?? null),
    ...rowsFor('equity', bs.equity, bsCompare?.equity ?? null),
    {
      key: 'cumulative',
      name: t('statements.cumulativeNetIncome'),
      depth: 1,
      current: bs.cumulativeNetIncome,
      compare: bsCompare?.cumulativeNetIncome ?? null,
      difference: bsCompare ? bs.cumulativeNetIncome - bsCompare.cumulativeNetIncome : null,
    },
    summary('equity-total', t('statements.equityTotal'), bs.totalEquity, bsCompare?.totalEquity ?? null),
    summary(
      'liability-equity-total',
      t('statements.liabilityEquityTotal'),
      liabilitiesAndEquity,
      bsCompare ? bsCompare.totalLiabilities + bsCompare.totalEquity : null,
    ),
  ]
  const balanced = bs.totalAssets === liabilitiesAndEquity

  const renderTable = (rows: DisplayRow[]) => (
    <table className="analysis__table">
      <thead>
        <tr>
          <th>{t('statements.account')}</th>
          <th className="analysis__num">{periodLabel}</th>
          {hasComparison && (
            <>
              <th className="analysis__num">{comparisonLabel}</th>
              <th className="analysis__num">{t('statements.difference')}</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.isSummary ? 'analysis__row--summary' : undefined}>
            <td className={r.row?.kind === 'group' ? 'analysis__cell--group' : undefined}>
              <div className="analysis__name" style={{ paddingLeft: r.depth * 16 }}>
                {r.row?.kind === 'group' && (
                  <button
                    type="button"
                    className="analysis__toggle"
                    aria-expanded={!r.row.isCollapsed}
                    aria-label={t('statements.toggleGroup', { name: r.name })}
                    onClick={() => toggle(r.row!.groupId!)}
                  >
                    {r.row.isCollapsed ? '▸' : '▾'}
                  </button>
                )}
                {r.row?.kind === 'account' ? (
                  <button type="button" className="analysis__link" onClick={() => onOpenAccount(r.row!.accountId!)}>
                    {r.name}
                  </button>
                ) : (
                  <span>{r.name}</span>
                )}
              </div>
            </td>
            <td className="analysis__num">{r.signed ? signedYen(r.current) : yen(r.current)}</td>
            {hasComparison && (
              <>
                <td className="analysis__num analysis__num--muted">
                  {r.compare === null ? '' : r.signed ? signedYen(r.compare) : yen(r.compare)}
                </td>
                <td className="analysis__num">{r.difference === null ? '' : signedYen(r.difference)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )

  const positive = (n: number) => Math.max(n, 0)

  return (
    <div className="analysis__statements">
      <section className="analysis__card" aria-label={t('statements.pl')}>
        <div className="analysis__card-head">
          <h2 className="analysis__card-title">{t('statements.pl')}</h2>
          <span className="analysis__card-note">{periodLabel}</span>
        </div>
        {renderTable(plRows)}
      </section>

      <section className="analysis__card" aria-label={t('statements.bs')}>
        <div className="analysis__card-head">
          <h2 className="analysis__card-title">{t('statements.bs')}</h2>
          <span className="analysis__card-note">{t('statements.asOf', { date: period.to })}</span>
        </div>
        <div className="analysis__bs-bars" aria-hidden="true">
          <div className="analysis__bs-bar">
            <span>{t('statements.assets')}</span>
            <div className="analysis__bs-segments">
              <div className="analysis__bs-segment analysis__bs-segment--assets" style={{ flex: positive(bs.totalAssets) || 1 }} />
            </div>
          </div>
          <div className="analysis__bs-bar">
            <span>{t('statements.liabilityEquity')}</span>
            <div className="analysis__bs-segments">
              <div className="analysis__bs-segment analysis__bs-segment--liabilities" style={{ flex: positive(bs.totalLiabilities) || 1 }} />
              <div className="analysis__bs-segment analysis__bs-segment--equity" style={{ flex: positive(bs.totalEquity) || 1 }} />
            </div>
          </div>
        </div>
        <ul className="analysis__legend">
          <li>
            <span aria-hidden="true" className="analysis__swatch analysis__bs-segment--assets" />
            {t('statements.assets')} {yen(bs.totalAssets)}
          </li>
          <li>
            <span aria-hidden="true" className="analysis__swatch analysis__bs-segment--liabilities" />
            {t('statements.liabilities')} {yen(bs.totalLiabilities)}
          </li>
          <li>
            <span aria-hidden="true" className="analysis__swatch analysis__bs-segment--equity" />
            {t('statements.equity')} {yen(bs.totalEquity)}
          </li>
        </ul>
        <p className={balanced ? 'analysis__identity' : 'analysis__identity analysis__identity--error'} role="status">
          {balanced
            ? `✓ ${t('statements.balanced', { assets: yen(bs.totalAssets), liabilityEquity: yen(liabilitiesAndEquity) })}`
            : `✕ ${t('statements.unbalanced', { assets: yen(bs.totalAssets), liabilityEquity: yen(liabilitiesAndEquity) })}`}
        </p>
        {renderTable(bsRows)}
      </section>
    </div>
  )
}
