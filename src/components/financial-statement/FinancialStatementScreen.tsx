import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { AccountAmount } from '../../domain/financial-statement/AccountAmount'
import type { FinancialStatementFilter } from '../../domain/financial-statement/FinancialStatementFilter'
import { generateFilteredProfitAndLoss } from '../../domain/financial-statement/generateFilteredProfitAndLoss'
import { generateFilteredBalanceSheet } from '../../domain/financial-statement/generateFilteredBalanceSheet'
import { compareAccountAmounts } from '../../domain/financial-statement/compareAccountAmounts'
import { getFirstDayOfMonth } from '../../domain/financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../../domain/financial-statement/getLastDayOfMonth'
import { getPreviousPeriod } from '../../domain/financial-statement/getPreviousPeriod'
import { getPreviousYearPeriod } from '../../domain/financial-statement/getPreviousYearPeriod'
import { shiftDateByMonths } from '../../domain/financial-statement/shiftDateByMonths'
import { shiftDateByYears } from '../../domain/financial-statement/shiftDateByYears'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './FinancialStatementScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}
interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface CounterpartyFinder {
  findAll(): Counterparty[] | Promise<Counterparty[]>
}

export interface FinancialStatementScreenProps {
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  onBack: () => void
  /** テスト用に「今日」を注入できるようにする(期間プリセットの基準)。省略時は実際の今日の日付 */
  today?: string
}

interface LoadedData {
  accounts: Account[]
  entries: JournalEntry[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
}

type Tab = 'pl' | 'bs'
type PeriodInputMode = 'yearMonth' | 'date'
type ComparisonMode = 'none' | 'previousPeriod' | 'previousYear'

const YEAR_OPTIONS_BEFORE = 5
const YEAR_OPTIONS_AFTER = 1
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

/**
 * 財務諸表(PL/BS)表示画面(計画Issue #34)。単一画面でPL/BSをタブ切替表示し、
 * プロジェクト・世帯メンバー・取引先の複数選択フィルタ(docs/domain/financial-statements.md
 * 2.2節)をタブ間で共有する(フィルタパネルはタブの外側に置き、タブ切替時に
 * アンマウントされないようにすることで選択状態を自然に保持する)。期間・基準日は
 * 年月プルダウン(プリセット、月初/月末に機械的に丸める)または日付の詳細指定の
 * いずれかを選べる。比較(前期・前年同期)を有効にすると、当期・比較期間・差分を
 * 同一テーブル内に表示する(2.2節では任意機能とされるが計画Issue #34でスコープインした)。
 */
export function FinancialStatementScreen({
  accountRepository,
  journalEntryRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onBack,
  today,
}: FinancialStatementScreenProps) {
  const { t } = useTranslation('financialStatement')
  const { t: tCommon } = useTranslation('common')

  const todayDate = today ?? new Date().toISOString().slice(0, 10)
  const currentYear = Number(todayDate.slice(0, 4))
  const currentMonth = Number(todayDate.slice(5, 7))
  const yearOptions = Array.from(
    { length: YEAR_OPTIONS_BEFORE + YEAR_OPTIONS_AFTER + 1 },
    (_, i) => currentYear - YEAR_OPTIONS_BEFORE + i,
  )

  const [data, setData] = useState<LoadedData | null>(null)
  const [tab, setTab] = useState<Tab>('pl')
  const [periodInputMode, setPeriodInputMode] = useState<PeriodInputMode>('yearMonth')
  const [plFromYear, setPlFromYear] = useState(currentYear)
  const [plFromMonth, setPlFromMonth] = useState(currentMonth)
  const [plToYear, setPlToYear] = useState(currentYear)
  const [plToMonth, setPlToMonth] = useState(currentMonth)
  const [plFromDateInput, setPlFromDateInput] = useState(getFirstDayOfMonth(currentYear, currentMonth))
  const [plToDateInput, setPlToDateInput] = useState(getLastDayOfMonth(currentYear, currentMonth))
  const [bsYear, setBsYear] = useState(currentYear)
  const [bsMonth, setBsMonth] = useState(currentMonth)
  const [bsDateInput, setBsDateInput] = useState(todayDate)
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('none')
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([])
  const [selectedHouseholdMemberIds, setSelectedHouseholdMemberIds] = useState<number[]>([])
  const [selectedCounterpartyIds, setSelectedCounterpartyIds] = useState<number[]>([])

  useEffect(() => {
    void Promise.all([
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(([accounts, entries, projects, householdMembers, counterparties]) => {
      setData({ accounts, entries, projects, householdMembers, counterparties })
    })
  }, [accountRepository, journalEntryRepository, projectRepository, householdMemberRepository, counterpartyRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const filter: FinancialStatementFilter = {}
  if (selectedProjectIds.length > 0) filter.projectIds = selectedProjectIds
  if (selectedHouseholdMemberIds.length > 0) filter.householdMemberIds = selectedHouseholdMemberIds
  if (selectedCounterpartyIds.length > 0) filter.counterpartyIds = selectedCounterpartyIds

  const plPeriod =
    periodInputMode === 'yearMonth'
      ? { from: getFirstDayOfMonth(plFromYear, plFromMonth), to: getLastDayOfMonth(plToYear, plToMonth) }
      : { from: plFromDateInput, to: plToDateInput }
  const bsAsOfDate = periodInputMode === 'yearMonth' ? getLastDayOfMonth(bsYear, bsMonth) : bsDateInput

  const pl = generateFilteredProfitAndLoss(data.entries, data.accounts, plPeriod.from, plPeriod.to, filter)
  const bs = generateFilteredBalanceSheet(data.entries, data.accounts, bsAsOfDate, filter)

  const plComparisonPeriod =
    comparisonMode === 'previousPeriod'
      ? getPreviousPeriod(plPeriod)
      : comparisonMode === 'previousYear'
        ? getPreviousYearPeriod(plPeriod)
        : null
  const plComparison =
    plComparisonPeriod === null
      ? null
      : generateFilteredProfitAndLoss(
          data.entries,
          data.accounts,
          plComparisonPeriod.from,
          plComparisonPeriod.to,
          filter,
        )

  const bsComparisonAsOfDate =
    comparisonMode === 'previousPeriod'
      ? shiftDateByMonths(bsAsOfDate, -1)
      : comparisonMode === 'previousYear'
        ? shiftDateByYears(bsAsOfDate, -1)
        : null
  const bsComparison =
    bsComparisonAsOfDate === null
      ? null
      : generateFilteredBalanceSheet(data.entries, data.accounts, bsComparisonAsOfDate, filter)

  function applyThisMonthPreset() {
    setPeriodInputMode('yearMonth')
    setPlFromYear(currentYear)
    setPlFromMonth(currentMonth)
    setPlToYear(currentYear)
    setPlToMonth(currentMonth)
  }

  function applyThisYearPreset() {
    setPeriodInputMode('yearMonth')
    setPlFromYear(currentYear)
    setPlFromMonth(1)
    setPlToYear(currentYear)
    setPlToMonth(12)
  }

  function renderCategorySection(key: string, titleKey: string, current: AccountAmount[], comparison: AccountAmount[] | null) {
    const rows = comparison === null ? null : compareAccountAmounts(current, comparison)
    const isEmpty = rows === null ? current.length === 0 : rows.length === 0

    return (
      <div className="fs-category" key={key}>
        <h3>{t(titleKey)}</h3>
        {isEmpty ? (
          <p>{t('emptyBreakdown')}</p>
        ) : (
          <table>
            <tbody>
              {rows !== null
                ? rows.map((row) => (
                    <tr key={row.accountId}>
                      <td>{row.accountName}</td>
                      <td>{formatCurrency(row.currentAmount, 'JPY')}</td>
                      <td>{formatCurrency(row.comparisonAmount, 'JPY')}</td>
                      <td>{formatCurrency(row.difference, 'JPY')}</td>
                    </tr>
                  ))
                : current.map((item) => (
                    <tr key={item.accountId}>
                      <td>{item.accountName}</td>
                      <td>{formatCurrency(item.amount, 'JPY')}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div className="financial-statement-screen">
      <h2>{t('screenTitle')}</h2>

      <div className="fs-tabs">
        <button type="button" aria-pressed={tab === 'pl'} onClick={() => setTab('pl')}>
          {t('tabProfitAndLoss')}
        </button>
        <button type="button" aria-pressed={tab === 'bs'} onClick={() => setTab('bs')}>
          {t('tabBalanceSheet')}
        </button>
      </div>

      <div className="fs-filter-panel">
        <div>
          <label htmlFor="fs-filter-project">{t('filterProjectLabel')}</label>
          <select
            id="fs-filter-project"
            multiple
            value={selectedProjectIds.map(String)}
            onChange={(event) =>
              setSelectedProjectIds(Array.from(event.target.selectedOptions, (option) => Number(option.value)))
            }
          >
            {data.projects
              .filter((project) => project.isActive || selectedProjectIds.includes(project.id))
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="fs-filter-household-member">{t('filterHouseholdMemberLabel')}</label>
          <select
            id="fs-filter-household-member"
            multiple
            value={selectedHouseholdMemberIds.map(String)}
            onChange={(event) =>
              setSelectedHouseholdMemberIds(
                Array.from(event.target.selectedOptions, (option) => Number(option.value)),
              )
            }
          >
            {data.householdMembers
              .filter((member) => member.isActive || selectedHouseholdMemberIds.includes(member.id))
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="fs-filter-counterparty">{t('filterCounterpartyLabel')}</label>
          <select
            id="fs-filter-counterparty"
            multiple
            value={selectedCounterpartyIds.map(String)}
            onChange={(event) =>
              setSelectedCounterpartyIds(
                Array.from(event.target.selectedOptions, (option) => Number(option.value)),
              )
            }
          >
            {data.counterparties
              .filter((counterparty) => counterparty.isActive || selectedCounterpartyIds.includes(counterparty.id))
              .map((counterparty) => (
                <option key={counterparty.id} value={counterparty.id}>
                  {counterparty.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="fs-period-panel">
        <div className="fs-period-mode">
          <label>
            <input
              type="radio"
              name="fs-period-mode"
              checked={periodInputMode === 'yearMonth'}
              onChange={() => setPeriodInputMode('yearMonth')}
            />
            {t('periodModeYearMonth')}
          </label>
          <label>
            <input
              type="radio"
              name="fs-period-mode"
              checked={periodInputMode === 'date'}
              onChange={() => setPeriodInputMode('date')}
            />
            {t('periodModeDate')}
          </label>
        </div>

        {tab === 'pl' ? (
          periodInputMode === 'yearMonth' ? (
            <div className="fs-period-fields">
              <label htmlFor="fs-pl-from-year">{t('periodFromLabel')}</label>
              <select id="fs-pl-from-year" value={plFromYear} onChange={(e) => setPlFromYear(Number(e.target.value))}>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                    {t('yearUnit')}
                  </option>
                ))}
              </select>
              <select
                id="fs-pl-from-month"
                aria-label={`${t('periodFromLabel')}${t('monthUnit')}`}
                value={plFromMonth}
                onChange={(e) => setPlFromMonth(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((month) => (
                  <option key={month} value={month}>
                    {month}
                    {t('monthUnit')}
                  </option>
                ))}
              </select>
              <label htmlFor="fs-pl-to-year">{t('periodToLabel')}</label>
              <select id="fs-pl-to-year" value={plToYear} onChange={(e) => setPlToYear(Number(e.target.value))}>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                    {t('yearUnit')}
                  </option>
                ))}
              </select>
              <select
                id="fs-pl-to-month"
                aria-label={`${t('periodToLabel')}${t('monthUnit')}`}
                value={plToMonth}
                onChange={(e) => setPlToMonth(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((month) => (
                  <option key={month} value={month}>
                    {month}
                    {t('monthUnit')}
                  </option>
                ))}
              </select>
              <button type="button" onClick={applyThisMonthPreset}>
                {t('presetThisMonth')}
              </button>
              <button type="button" onClick={applyThisYearPreset}>
                {t('presetThisYear')}
              </button>
            </div>
          ) : (
            <div className="fs-period-fields">
              <label htmlFor="fs-pl-from-date">{t('periodFromLabel')}</label>
              <input
                id="fs-pl-from-date"
                type="date"
                value={plFromDateInput}
                onChange={(e) => setPlFromDateInput(e.target.value)}
              />
              <label htmlFor="fs-pl-to-date">{t('periodToLabel')}</label>
              <input
                id="fs-pl-to-date"
                type="date"
                value={plToDateInput}
                onChange={(e) => setPlToDateInput(e.target.value)}
              />
            </div>
          )
        ) : periodInputMode === 'yearMonth' ? (
          <div className="fs-period-fields">
            <label htmlFor="fs-bs-year">{t('asOfDateLabel')}</label>
            <select id="fs-bs-year" value={bsYear} onChange={(e) => setBsYear(Number(e.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                  {t('yearUnit')}
                </option>
              ))}
            </select>
            <select
              id="fs-bs-month"
              aria-label={`${t('asOfDateLabel')}${t('monthUnit')}`}
              value={bsMonth}
              onChange={(e) => setBsMonth(Number(e.target.value))}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month} value={month}>
                  {month}
                  {t('monthUnit')}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="fs-period-fields">
            <label htmlFor="fs-bs-date">{t('asOfDateLabel')}</label>
            <input id="fs-bs-date" type="date" value={bsDateInput} onChange={(e) => setBsDateInput(e.target.value)} />
          </div>
        )}
      </div>

      <div className="fs-comparison-panel">
        <label htmlFor="fs-comparison-mode">{t('comparisonLabel')}</label>
        <select
          id="fs-comparison-mode"
          value={comparisonMode}
          onChange={(e) => setComparisonMode(e.target.value as ComparisonMode)}
        >
          <option value="none">{t('comparisonNone')}</option>
          <option value="previousPeriod">{t('comparisonPreviousPeriod')}</option>
          <option value="previousYear">{t('comparisonPreviousYear')}</option>
        </select>
      </div>

      <div className="fs-content">
        {tab === 'pl'
          ? [
              { key: 'revenues', titleKey: 'revenuesTitle', current: pl.revenues, comparison: plComparison?.revenues ?? null },
              { key: 'expenses', titleKey: 'expensesTitle', current: pl.expenses, comparison: plComparison?.expenses ?? null },
            ].map((section) => renderCategorySection(section.key, section.titleKey, section.current, section.comparison))
          : [
              { key: 'assets', titleKey: 'assetsTitle', current: bs.assets, comparison: bsComparison?.assets ?? null },
              {
                key: 'liabilities',
                titleKey: 'liabilitiesTitle',
                current: bs.liabilities,
                comparison: bsComparison?.liabilities ?? null,
              },
              { key: 'equity', titleKey: 'equityTitle', current: bs.equity, comparison: bsComparison?.equity ?? null },
            ].map((section) => renderCategorySection(section.key, section.titleKey, section.current, section.comparison))}

        <div className="fs-totals">
          {tab === 'pl' ? (
            <>
              <p>
                <span>{t('totalRevenueLabel')}:</span>
                <span>{formatCurrency(pl.totalRevenue, 'JPY')}</span>
                {plComparison !== null && (
                  <>
                    <span>{formatCurrency(plComparison.totalRevenue, 'JPY')}</span>
                    <span>{formatCurrency(pl.totalRevenue - plComparison.totalRevenue, 'JPY')}</span>
                  </>
                )}
              </p>
              <p>
                <span>{t('totalExpenseLabel')}:</span>
                <span>{formatCurrency(pl.totalExpense, 'JPY')}</span>
                {plComparison !== null && (
                  <>
                    <span>{formatCurrency(plComparison.totalExpense, 'JPY')}</span>
                    <span>{formatCurrency(pl.totalExpense - plComparison.totalExpense, 'JPY')}</span>
                  </>
                )}
              </p>
              <p>
                <span>{t('netIncomeLabel')}:</span>
                <span>{formatCurrency(pl.netIncome, 'JPY')}</span>
                {plComparison !== null && (
                  <>
                    <span>{formatCurrency(plComparison.netIncome, 'JPY')}</span>
                    <span>{formatCurrency(pl.netIncome - plComparison.netIncome, 'JPY')}</span>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p>
                <span>{t('totalAssetsLabel')}:</span>
                <span>{formatCurrency(bs.totalAssets, 'JPY')}</span>
                {bsComparison !== null && (
                  <>
                    <span>{formatCurrency(bsComparison.totalAssets, 'JPY')}</span>
                    <span>{formatCurrency(bs.totalAssets - bsComparison.totalAssets, 'JPY')}</span>
                  </>
                )}
              </p>
              <p>
                <span>{t('totalLiabilitiesLabel')}:</span>
                <span>{formatCurrency(bs.totalLiabilities, 'JPY')}</span>
                {bsComparison !== null && (
                  <>
                    <span>{formatCurrency(bsComparison.totalLiabilities, 'JPY')}</span>
                    <span>{formatCurrency(bs.totalLiabilities - bsComparison.totalLiabilities, 'JPY')}</span>
                  </>
                )}
              </p>
              <p>
                <span>{t('totalEquityLabel')}:</span>
                <span>{formatCurrency(bs.totalEquity, 'JPY')}</span>
                {bsComparison !== null && (
                  <>
                    <span>{formatCurrency(bsComparison.totalEquity, 'JPY')}</span>
                    <span>{formatCurrency(bs.totalEquity - bsComparison.totalEquity, 'JPY')}</span>
                  </>
                )}
              </p>
              <p>
                <span>{t('cumulativeNetIncomeLabel')}:</span>
                <span>{formatCurrency(bs.cumulativeNetIncome, 'JPY')}</span>
              </p>
              <p>
                <span>{t('identityCheckLabel')}:</span>
                <span>{formatCurrency(bs.totalLiabilities + bs.totalEquity, 'JPY')}</span>
              </p>
            </>
          )}
        </div>
      </div>

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
