import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import '../common/journal-filter/JournalFilterPanel.css'
import { PeriodRangeInput } from '../common/period-range/PeriodRangeInput'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import {
  activeConditionCount,
  batchFilterCategories,
  memberFilterCategories,
  resolveFilterInput,
  withUnsetCategory,
  type FilterAxis,
  type ImportFilterInput,
} from './importRowFilter'

export interface ImportRowFilterPanelProps {
  input: ImportFilterInput
  /** 入力が変わった(変更後の入力全体を渡す) */
  onChange: (next: ImportFilterInput) => void
  onClear: () => void
  counterAccountCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
  members: readonly HouseholdMember[]
  batches: readonly SettlementBatch[]
  /** いま開いているタブの、表示中の件数 */
  resultCount: number
  /** 取り込む行の日付(期間を月で選ぶときの、月の選択肢を作る。計画Issue #314) */
  dates: readonly string[]
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="journal-filter__field">
      <span className="journal-filter__label">{label}</span>
      {children}
    </div>
  )
}

/**
 * 明細取込画面の行の絞り込みパネル(計画Issue #258)。仕訳一覧の絞り込みパネル(JournalFilterPanel)と同じ作りと見た目で、
 * 摘要の検索欄・期間・金額、相手科目・取引先・プロジェクト・世帯メンバー・精算バッチの複数選択欄(各欄の先頭に「未設定」、精算バッチは
 * 「未割当」。科目・取引先・プロジェクトはグループごとの選択もできる)、条件があるときの「条件をクリア」、件数を並べる。
 * 条件の状態は呼び出し側が持つ制御コンポーネント。選択欄は共通の選択ツリー(TreeSelect)で、階層のインデント・検索窓・Enter確定は
 * その部品のまま。
 */
export function ImportRowFilterPanel({
  input,
  onChange,
  onClear,
  counterAccountCategories,
  counterpartyCategories,
  projectCategories,
  members,
  batches,
  resultCount,
  dates,
}: ImportRowFilterPanelProps) {
  const { t } = useTranslation('statementImport')
  const unset = t('filterUnset')
  const unassigned = t('filterUnassigned')
  const categories = useMemo(
    () => ({
      counterAccount: withUnsetCategory(counterAccountCategories, unset),
      counterparty: withUnsetCategory(counterpartyCategories, unset),
      project: withUnsetCategory(projectCategories, unset),
      member: withUnsetCategory(memberFilterCategories(members), unset),
      batch: withUnsetCategory(batchFilterCategories(batches), unassigned),
    }),
    [counterAccountCategories, counterpartyCategories, projectCategories, members, batches, unset, unassigned],
  )
  const activeCount = activeConditionCount(resolveFilterInput(input, categories))

  const field = (axis: FilterAxis, label: string, favoriteKind?: 'account' | 'counterparty' | 'project') => (
    <Field label={label}>
      <TreeSelect
        label={label}
        categories={categories[axis]}
        favoriteKind={favoriteKind}
        multiple
        values={input.values[axis]}
        onValuesChange={(values) => onChange({ ...input, values: { ...input.values, [axis]: values } })}
        allowGroupSelect={axis === 'counterAccount' || axis === 'counterparty' || axis === 'project'}
        emptyLabel={t('filterEmptyLabel')}
      />
    </Field>
  )

  return (
    <div className="journal-filter" role="search" aria-label={t('filterPanelLabel')}>
      <div className="journal-filter__row">
        <input
          type="search"
          className="journal-filter__text"
          aria-label={t('filterDescriptionLabel')}
          placeholder={t('filterDescriptionLabel')}
          value={input.description}
          onChange={(event) => onChange({ ...input, description: event.target.value })}
        />
        <PeriodRangeInput
          label={t('filterPeriodLabel')}
          fromLabel={t('filterDateFromLabel')}
          toLabel={t('filterDateToLabel')}
          byDateLabel={t('filterByDate')}
          unsetLabel={t('filterEmptyLabel')}
          from={input.dateFrom}
          to={input.dateTo}
          dates={dates}
          onChange={(dateFrom, dateTo) => onChange({ ...input, dateFrom, dateTo })}
        />
        <div className="journal-filter__range">
          <span className="journal-filter__label">{t('filterAmountLabel')}</span>
          <input
            type="text"
            inputMode="numeric"
            className="journal-filter__input journal-filter__input--amount"
            aria-label={t('filterAmountMinLabel')}
            value={input.amountMin}
            onChange={(event) => onChange({ ...input, amountMin: event.target.value })}
          />
          <span aria-hidden="true">〜</span>
          <input
            type="text"
            inputMode="numeric"
            className="journal-filter__input journal-filter__input--amount"
            aria-label={t('filterAmountMaxLabel')}
            value={input.amountMax}
            onChange={(event) => onChange({ ...input, amountMax: event.target.value })}
          />
        </div>
      </div>

      <div className="journal-filter__fields">
        {field('counterAccount', t('filterCounterAccountLabel'), 'account')}
        {field('counterparty', t('filterCounterpartyLabel'), 'counterparty')}
        {field('project', t('filterProjectLabel'), 'project')}
        {field('member', t('filterMemberLabel'))}
        {field('batch', t('filterBatchLabel'))}
      </div>

      <div className="journal-filter__footer">
        {activeCount > 0 && (
          <button type="button" className="journal-filter__clear" onClick={onClear}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            {t('filterClear')}
          </button>
        )}
        <span role="status" className="journal-filter__count">
          {t('filterCount', { count: resultCount })}
        </span>
      </div>
    </div>
  )
}
