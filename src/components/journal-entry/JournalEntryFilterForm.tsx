import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Project } from '../../domain/project/Project'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import './JournalEntryFilterForm.css'

export interface JournalEntryFilterFormProps {
  filter: JournalEntryFilter
  onChange: (filter: JournalEntryFilter) => void
  accounts: readonly Account[]
  householdMembers: readonly HouseholdMember[]
  projects: readonly Project[]
}

/**
 * 仕訳の期間・科目・世帯メンバー・プロジェクト絞り込みUI(計画Issue #40)。
 * 割勘対象選択画面の入口として新設したが、他画面(将来の仕訳一覧への検索強化等)からも
 * 再利用できるよう、フィルタ状態(JournalEntryFilter)を呼び出し側が管理する制御
 * コンポーネントとして実装する。各入力欄の変更時は、当該フィールドのみを追加・削除した
 * 新しいfilterオブジェクトでonChangeを呼ぶ(他のフィールドは維持する)。
 */
export function JournalEntryFilterForm({
  filter,
  onChange,
  accounts,
  householdMembers,
  projects,
}: JournalEntryFilterFormProps) {
  const { t } = useTranslation('journal')

  function updateFilter<K extends keyof JournalEntryFilter>(key: K, value: JournalEntryFilter[K] | undefined) {
    const next = { ...filter }
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
    onChange(next)
  }

  return (
    <div className="journal-entry-filter-form">
      <div>
        <label htmlFor="journal-entry-filter-date-from">{t('filterDateFromLabel')}</label>
        <input
          id="journal-entry-filter-date-from"
          type="date"
          value={filter.dateFrom ?? ''}
          onChange={(event) => updateFilter('dateFrom', event.target.value === '' ? undefined : event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="journal-entry-filter-date-to">{t('filterDateToLabel')}</label>
        <input
          id="journal-entry-filter-date-to"
          type="date"
          value={filter.dateTo ?? ''}
          onChange={(event) => updateFilter('dateTo', event.target.value === '' ? undefined : event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="journal-entry-filter-account">{t('filterAccountLabel')}</label>
        <select
          id="journal-entry-filter-account"
          value={filter.accountId ?? ''}
          onChange={(event) =>
            updateFilter('accountId', event.target.value === '' ? undefined : Number(event.target.value))
          }
        >
          <option value="">{t('unselected')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="journal-entry-filter-household-member">{t('filterHouseholdMemberLabel')}</label>
        <select
          id="journal-entry-filter-household-member"
          value={filter.householdMemberId ?? ''}
          onChange={(event) =>
            updateFilter('householdMemberId', event.target.value === '' ? undefined : Number(event.target.value))
          }
        >
          <option value="">{t('unselected')}</option>
          {householdMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="journal-entry-filter-project">{t('filterProjectLabel')}</label>
        <select
          id="journal-entry-filter-project"
          value={filter.projectId ?? ''}
          onChange={(event) =>
            updateFilter('projectId', event.target.value === '' ? undefined : Number(event.target.value))
          }
        >
          <option value="">{t('unselected')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
