import { useTranslation } from 'react-i18next'
import type { AnalysisComparisonMode, AnalysisPresetKey } from '../../domain/analysis/analysisPeriod'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import type { AnalysisConditionValues } from './analysisConditionsModel'

/** 期間の指定。月で指定するか、日付で指定するか(日単位の期間指定は従来の機能を維持する)。 */
export interface AnalysisPeriodInput {
  mode: 'month' | 'date'
  /** 選択中のプリセット。開始・終了を手で変えたらnull */
  preset: AnalysisPresetKey | null
  fromMonth: string
  toMonth: string
  fromDate: string
  toDate: string
}

export interface AnalysisConditionBarProps {
  period: AnalysisPeriodInput
  onPeriodChange: (next: Partial<AnalysisPeriodInput>) => void
  onPresetPick: (key: AnalysisPresetKey) => void
  onModeChange: (mode: 'month' | 'date') => void
  monthOptions: readonly string[]
  comparison: AnalysisComparisonMode
  onComparisonChange: (mode: AnalysisComparisonMode) => void
  values: AnalysisConditionValues
  onValuesChange: (values: AnalysisConditionValues) => void
  memberCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
}

const PRESETS: AnalysisPresetKey[] = ['thisMonth', 'last3Months', 'thisYear', 'last12Months', 'lastYear']
const COMPARISONS: AnalysisComparisonMode[] = ['none', 'previousPeriod', 'previousYear']

/**
 * 分析画面の条件バー(計画Issue #155)。期間のプリセットと開始・終了、比較、世帯メンバー・
 * プロジェクト・取引先を上に置き、すべてのタブで共通にする(予算タブは終了月だけを使う)。
 * 開始・終了は月の選択を基本とし、「日付で指定」で日単位の入力に切り替えられる。
 */
export function AnalysisConditionBar(props: AnalysisConditionBarProps) {
  const { period, onPeriodChange, onPresetPick, onModeChange, monthOptions, comparison, values, onValuesChange } = props
  const { t } = useTranslation('analysis')

  const monthLabel = (value: string) => t('yearMonthOption', { year: value.slice(0, 4), month: Number(value.slice(5, 7)) })

  return (
    <div role="group" aria-label={t('conditionsLabel')} className="analysis__conditions">
      <div className="analysis__presets">
        {PRESETS.map((key) => (
          <button
            key={key}
            type="button"
            className="analysis__preset"
            aria-pressed={period.preset === key}
            onClick={() => onPresetPick(key)}
          >
            {t(`preset.${key}`)}
          </button>
        ))}
      </div>

      <div className="analysis__range">
        <div className="analysis__field">
          <label className="analysis__label" htmlFor="analysis-from">
            {t('periodStart')}
          </label>
          {period.mode === 'month' ? (
            <select
              id="analysis-from"
              className="analysis__control"
              value={period.fromMonth}
              onChange={(e) => onPeriodChange({ fromMonth: e.target.value, preset: null })}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="analysis-from"
              type="date"
              className="analysis__control"
              value={period.fromDate}
              onChange={(e) => onPeriodChange({ fromDate: e.target.value, preset: null })}
            />
          )}
        </div>
        <span aria-hidden="true" className="analysis__range-separator">
          {t('periodRangeSeparator')}
        </span>
        <div className="analysis__field">
          <label className="analysis__label" htmlFor="analysis-to">
            {period.mode === 'month' ? t('periodEndMonth') : t('periodEndDate')}
          </label>
          {period.mode === 'month' ? (
            <select
              id="analysis-to"
              className="analysis__control"
              value={period.toMonth}
              onChange={(e) => onPeriodChange({ toMonth: e.target.value, preset: null })}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="analysis-to"
              type="date"
              className="analysis__control"
              value={period.toDate}
              onChange={(e) => onPeriodChange({ toDate: e.target.value, preset: null })}
            />
          )}
        </div>
        <label className="analysis__check">
          <input
            type="checkbox"
            checked={period.mode === 'date'}
            onChange={(e) => onModeChange(e.target.checked ? 'date' : 'month')}
          />
          {t('byDate')}
        </label>
      </div>

      <div className="analysis__field">
        <label className="analysis__label" htmlFor="analysis-comparison">
          {t('comparison.label')}
        </label>
        <select
          id="analysis-comparison"
          className="analysis__control"
          value={comparison}
          onChange={(e) => props.onComparisonChange(e.target.value as AnalysisComparisonMode)}
        >
          {COMPARISONS.map((mode) => (
            <option key={mode} value={mode}>
              {t(`comparison.${mode}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="analysis__field analysis__field--picker">
        <span className="analysis__label">{t('filter.member')}</span>
        <TreeSelect
          label={t('filter.member')}
          categories={props.memberCategories}
          value={values.member}
          onChange={(member) => onValuesChange({ ...values, member })}
          emptyLabel={t('filter.memberAll')}
          placeholder={t('filter.memberAll')}
        />
      </div>
      <div className="analysis__field analysis__field--picker">
        <span className="analysis__label">{t('filter.project')}</span>
        <TreeSelect
          label={t('filter.project')}
          categories={props.projectCategories}
          value={values.project}
          onChange={(project) => onValuesChange({ ...values, project })}
          allowGroupSelect
          emptyLabel={t('filter.any')}
          placeholder={t('filter.any')}
        />
      </div>
      <div className="analysis__field analysis__field--picker">
        <span className="analysis__label">{t('filter.counterparty')}</span>
        <TreeSelect
          label={t('filter.counterparty')}
          categories={props.counterpartyCategories}
          value={values.counterparty}
          onChange={(counterparty) => onValuesChange({ ...values, counterparty })}
          allowGroupSelect
          emptyLabel={t('filter.any')}
          placeholder={t('filter.any')}
        />
      </div>
    </div>
  )
}
