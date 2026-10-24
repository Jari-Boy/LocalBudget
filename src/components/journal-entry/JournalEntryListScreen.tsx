import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { Project } from '../../domain/project/Project'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalEntryFilterForm } from './JournalEntryFilterForm'
import './JournalEntryListScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
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

export interface JournalEntryListScreenProps {
  journalEntryRepository: JournalEntryFinder
  accountRepository: AccountFinder
  householdMemberRepository: HouseholdMemberFinder
  projectRepository: ProjectFinder
  onSelectEntry: (entry: JournalEntry) => void
  onBack: () => void
}

interface LoadedData {
  entries: JournalEntry[]
  accounts: Account[]
  householdMembers: HouseholdMember[]
  projects: Project[]
}

/** 借方/貸方という簿記用語を見せず、単一の取引金額として表示する(貸借は必ず一致するため借方合計で代表する) */
function calculateEntryTotal(entry: JournalEntry): number {
  return entry.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0)
}

/**
 * 確定済み仕訳一覧画面(計画Issue #40、テーブル化・フィルタ接続は計画Issue #125)。
 * journal_entriesを日付・摘要・取引金額のタスク指向の表現でテーブル形式に一覧表示する。
 * 借方/貸方・仕訳明細といった複式簿記の概念はUI上に出さない(docs/domain.md 1.1)。
 * 既存の共通コンポーネントJournalEntryFilterForm・filterJournalEntries(期間・科目・
 * 世帯メンバー・プロジェクト、計画Issue #40で割勘対象選択画面向けに新設され複数画面から
 * 再利用する設計だった)を接続する。1仕訳=1行のサマリー表示+詳細画面への遷移にとどめ、
 * インライン編集は行わない。借方/貸方が複数行にわたりうる仕訳の編集は、Linesテーブルを
 * 持つJournalEntryDetailScreenに委ねる設計判断(計画Issue #125)。本画面は仕訳確認専用であり、
 * 割勘起票への導線は持たない(ユーザーレビューで割勘対象の選択を専用の
 * ExpenseSplittingEntryPickerScreenへ分離した)。下書き一覧(JournalEntryDraftListScreen)とは別物。
 */
export function JournalEntryListScreen({
  journalEntryRepository,
  accountRepository,
  householdMemberRepository,
  projectRepository,
  onSelectEntry,
  onBack,
}: JournalEntryListScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [filter, setFilter] = useState<JournalEntryFilter>({})

  useEffect(() => {
    void Promise.all([
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
    ]).then(([entries, accounts, householdMembers, projects]) => {
      setData({ entries, accounts, householdMembers, projects })
    })
  }, [journalEntryRepository, accountRepository, householdMemberRepository, projectRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const entries = filterJournalEntries(data.entries, data.accounts, filter)

  return (
    <div className="journal-entry-list-screen">
      <h2>{t('entryListTitle')}</h2>

      <JournalEntryFilterForm
        filter={filter}
        onChange={setFilter}
        accounts={data.accounts}
        householdMembers={data.householdMembers}
        projects={data.projects}
      />

      {entries.length === 0 ? (
        <p>{t('entryListEmpty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">{t('entryDateLabel')}</th>
              <th scope="col">{t('memoLabel')}</th>
              <th scope="col">{t('entryAmountLabel')}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.entryDate}</td>
                <td>{entry.memo ?? t('entryNoMemo')}</td>
                <td>{formatCurrency(calculateEntryTotal(entry), 'JPY')}</td>
                <td>
                  <button type="button" onClick={() => onSelectEntry(entry)}>
                    {t('viewEntryDetail')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
