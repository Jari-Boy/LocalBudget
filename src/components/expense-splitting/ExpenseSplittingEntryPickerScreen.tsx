import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { Project } from '../../domain/project/Project'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { findUnallocatedEntries } from '../../domain/expense-splitting/findUnallocatedEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalEntryFilterForm } from '../journal-entry/JournalEntryFilterForm'
import './ExpenseSplittingEntryPickerScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  listLinksForEntry(entryId: number): JournalEntryLink[] | Promise<JournalEntryLink[]>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}

export interface ExpenseSplittingEntryPickerScreenProps {
  journalEntryRepository: JournalEntryFinder
  accountRepository: AccountFinder
  householdMemberRepository: HouseholdMemberFinder
  projectRepository: ProjectFinder
  onSelectEntry: (entry: JournalEntry) => void
  onBack: () => void
}

interface LoadedData {
  entries: JournalEntry[]
  unallocatedEntryIds: Set<number>
  accounts: Account[]
  householdMembers: HouseholdMember[]
  projects: Project[]
}

/** 借方/貸方という簿記用語を見せず、単一の取引金額として表示する(貸借は必ず一致するため借方合計で代表する) */
function calculateEntryTotal(entry: JournalEntry): number {
  return entry.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0)
}

/**
 * 割勘対象選択画面(計画Issue #40)。仕訳一覧(JournalEntryListScreen、確認用途の
 * 汎用画面)から割勘起票への導線を分離するため、ホーム画面に専用の入口を設ける
 * (ユーザーレビューでのUX見直し)。findUnallocatedEntries(docs/domain/
 * expense-splitting.md 1.5節)で未割勘の仕訳のみを候補にし、共通コンポーネントの
 * JournalEntryFilterForm(期間・科目・世帯メンバー・プロジェクト)による追加の絞り込みを
 * filterJournalEntriesで適用する。選択した仕訳は割勘起票フォームへそのまま渡す。
 */
export function ExpenseSplittingEntryPickerScreen({
  journalEntryRepository,
  accountRepository,
  householdMemberRepository,
  projectRepository,
  onSelectEntry,
  onBack,
}: ExpenseSplittingEntryPickerScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [filter, setFilter] = useState<JournalEntryFilter>({})

  useEffect(() => {
    void Promise.all([
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
    ]).then(async ([entries, accounts, householdMembers, projects]) => {
      const linksByEntryId = new Map<number, JournalEntryLink[]>()
      await Promise.all(
        entries.map(async (entry) => {
          linksByEntryId.set(entry.id, await Promise.resolve(journalEntryRepository.listLinksForEntry(entry.id)))
        }),
      )
      const unallocatedEntryIds = new Set(
        findUnallocatedEntries(entries, linksByEntryId).map((entry) => entry.id),
      )
      setData({ entries, unallocatedEntryIds, accounts, householdMembers, projects })
    })
  }, [journalEntryRepository, accountRepository, householdMemberRepository, projectRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const unallocatedEntries = data.entries.filter((entry) => data.unallocatedEntryIds.has(entry.id))
  const candidates = filterJournalEntries(unallocatedEntries, data.accounts, filter)

  return (
    <div className="expense-splitting-entry-picker-screen">
      <h2>{t('entryPickerTitle')}</h2>

      <JournalEntryFilterForm
        filter={filter}
        onChange={setFilter}
        accounts={data.accounts}
        householdMembers={data.householdMembers}
        projects={data.projects}
      />

      {candidates.length === 0 ? (
        <p>{t('entryPickerEmpty')}</p>
      ) : (
        <ul>
          {candidates.map((entry) => (
            <li key={entry.id}>
              <span>{entry.entryDate}</span>
              <span>{entry.memo ?? t('entryNoMemo')}</span>
              <span>{formatCurrency(calculateEntryTotal(entry), 'JPY')}</span>
              <button type="button" onClick={() => onSelectEntry(entry)}>
                {t('selectEntry')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
