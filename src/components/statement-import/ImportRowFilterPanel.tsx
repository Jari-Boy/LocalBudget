import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import '../common/journal-filter/JournalFilterPanel.css'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { activeConditionCount, memberFilterCategories, resolveFilterInput, withUnsetCategory, type FilterAxis, type ImportFilterInput } from './importRowFilter'

export interface ImportRowFilterPanelProps {
  input: ImportFilterInput
  onDescriptionChange: (description: string) => void
  /** 軸の選択(選択欄の値。「g:グループID」・「未設定」を含む)が変わった */
  onValuesChange: (axis: FilterAxis, values: string[]) => void
  onClear: () => void
  counterAccountCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
  members: readonly HouseholdMember[]
  /** いま開いているタブの、表示中の件数 */
  resultCount: number
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
 * 摘要の検索欄、相手科目・取引先・プロジェクト・世帯メンバーの複数選択欄(各欄の先頭に「未設定」。科目・取引先・プロジェクトは
 * グループごとの選択もできる)、条件があるときの「条件をクリア」、件数を並べる。条件の状態は呼び出し側が持つ制御コンポーネント。
 * 選択欄は共通の選択ツリー(TreeSelect)で、階層のインデント・検索窓・Enter確定はその部品のまま。
 */
export function ImportRowFilterPanel({
  input,
  onDescriptionChange,
  onValuesChange,
  onClear,
  counterAccountCategories,
  counterpartyCategories,
  projectCategories,
  members,
  resultCount,
}: ImportRowFilterPanelProps) {
  const { t } = useTranslation('statementImport')
  const unset = t('filterUnset')
  const categories = useMemo(
    () => ({
      counterAccount: withUnsetCategory(counterAccountCategories, unset),
      counterparty: withUnsetCategory(counterpartyCategories, unset),
      project: withUnsetCategory(projectCategories, unset),
      member: withUnsetCategory(memberFilterCategories(members), unset),
    }),
    [counterAccountCategories, counterpartyCategories, projectCategories, members, unset],
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
        onValuesChange={(values) => onValuesChange(axis, values)}
        allowGroupSelect={axis !== 'member'}
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
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </div>

      <div className="journal-filter__fields">
        {field('counterAccount', t('filterCounterAccountLabel'), 'account')}
        {field('counterparty', t('filterCounterpartyLabel'), 'counterparty')}
        {field('project', t('filterProjectLabel'), 'project')}
        {field('member', t('filterMemberLabel'))}
      </div>

      <div className="journal-filter__footer">
        {activeCount > 0 && (
          <button type="button" className="journal-filter__clear" onClick={onClear}>
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
