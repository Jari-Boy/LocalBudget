import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { Project } from '../../domain/project/Project'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { checkExpenseSplittability } from '../../domain/expense-splitting/checkExpenseSplittability'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalEntryFilterForm } from '../journal-entry/JournalEntryFilterForm'
import './ExpenseSplittingEntryPickerScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}
interface JournalEntryLinkGroupFinder {
  findAllMemberships(): JournalEntryLinkGroupMembership[] | Promise<JournalEntryLinkGroupMembership[]>
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
  journalEntryLinkGroupRepository: JournalEntryLinkGroupFinder
  accountRepository: AccountFinder
  householdMemberRepository: HouseholdMemberFinder
  projectRepository: ProjectFinder
  /** チェックボックスで選択された仕訳を、一覧の表示順でまとめて渡す(計画Issue #40の再指摘対応) */
  onSelectEntries: (entries: JournalEntry[]) => void
  onBack: () => void
}

interface LoadedData {
  entries: JournalEntry[]
  splittableEntryIds: Set<number>
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
 * (ユーザーレビューでのUX見直し)。checkExpenseSplittability(docs/domain/
 * expense-splitting.md 1.5節、計画Issue #149)で割勘できる仕訳のみを候補にする(割勘で作られた
 * 仕訳・割勘済みの仕訳・借方に費用の行がない仕訳は候補から除外する。費用の行が複数ある仕訳は
 * 割勘できる)。共通コンポーネントの
 * JournalEntryFilterForm(期間・科目・世帯メンバー・プロジェクト)による追加の絞り込みを
 * filterJournalEntriesで適用する。候補はチェックボックスで複数選択でき、「選択した
 * 仕訳で割勘する」ボタンで選択済みの仕訳をまとめて割勘起票フォームへ渡す(計画Issue #40
 * Attempt 4、人間レビューでの「複数の元仕訳をまとめて選択して一括起票したい」との
 * 指摘への対応)。
 */
export function ExpenseSplittingEntryPickerScreen({
  journalEntryRepository,
  journalEntryLinkGroupRepository,
  accountRepository,
  householdMemberRepository,
  projectRepository,
  onSelectEntries,
  onBack,
}: ExpenseSplittingEntryPickerScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [filter, setFilter] = useState<JournalEntryFilter>({})
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  function toggleSelected(entryId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) {
        next.delete(entryId)
      } else {
        next.add(entryId)
      }
      return next
    })
  }

  useEffect(() => {
    void Promise.all([
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(journalEntryLinkGroupRepository.findAllMemberships()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
    ]).then(([entries, memberships, accounts, householdMembers, projects]) => {
      const relatedEntryIdsByEntryId = buildRelatedEntryIdsByEntryId(memberships)
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
      const splittableEntryIds = new Set(
        entries
          .filter((entry) => {
            const relatedEntries = [...(relatedEntryIdsByEntryId.get(entry.id) ?? [])]
              .map((id) => entriesById.get(id))
              .filter((related): related is JournalEntry => related !== undefined)
            return checkExpenseSplittability(entry, accounts, relatedEntries).splittable
          })
          .map((entry) => entry.id),
      )
      setData({ entries, splittableEntryIds, accounts, householdMembers, projects })
    })
  }, [journalEntryRepository, journalEntryLinkGroupRepository, accountRepository, householdMemberRepository, projectRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const splittableEntries = data.entries.filter((entry) => data.splittableEntryIds.has(entry.id))
  const candidates = filterJournalEntries(splittableEntries, data.accounts, filter)

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
        <>
          <ul>
            {candidates.map((entry) => (
              <li key={entry.id}>
                <input
                  type="checkbox"
                  aria-label={t('selectEntryCheckboxLabel', { memo: entry.memo ?? t('entryNoMemo') })}
                  checked={selectedIds.has(entry.id)}
                  onChange={() => toggleSelected(entry.id)}
                />
                <span>{entry.entryDate}</span>
                <span>{entry.memo ?? t('entryNoMemo')}</span>
                <span>{formatCurrency(calculateEntryTotal(entry), 'JPY')}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => onSelectEntries(candidates.filter((entry) => selectedIds.has(entry.id)))}
          >
            {t('submitEntrySelection')}
          </button>
        </>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
