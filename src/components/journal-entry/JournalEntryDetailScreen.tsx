import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import type { Project } from '../../domain/project/Project'
import { traceExpenseSplittingHistory } from '../../domain/expense-splitting/traceExpenseSplittingHistory'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './JournalEntryDetailScreen.css'

interface JournalEntryFinder {
  findById(id: number): JournalEntry | null | Promise<JournalEntry | null>
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  listLinksForEntry(entryId: number): JournalEntryLink[] | Promise<JournalEntryLink[]>
  delete(id: number): void | Promise<void>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
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

export interface JournalEntryDetailScreenProps {
  entryId: number
  journalEntryRepository: JournalEntryFinder
  accountRepository: AccountFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  onBack: () => void
  /** 精算前の割勘仕訳を取り消し(物理削除)した後に呼ばれる */
  onDeleted?: () => void
}

interface LoadedData {
  entry: JournalEntry
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
  allEntries: JournalEntry[]
  linksByEntryId: Map<number, JournalEntryLink[]>
}

/**
 * 確定済み仕訳詳細画面(計画Issue #40)。個々の仕訳明細(科目名・金額・
 * プロジェクト・世帯メンバー・取引先)を借方/貸方といった簿記用語を見せずに表示する
 * (docs/domain.md 1.1)。この仕訳が割勘仕訳(allocatesリンクのfrom_entry側)である
 * 場合、精算済みかどうかに応じて取り消し導線(精算前は物理削除、精算後は返金案内)を
 * 出し分ける。この仕訳が元の支出仕訳である場合、そこから生まれた割勘・精算の履歴
 * (traceExpenseSplittingHistory、docs/domain/expense-splitting.md 1.5節)を表示する。
 * リンクの実体解決にはentries全体が必要なため、全仕訳・全リンクを読み込んでから
 * トレースする(docs/decisions.md 2026-08-01「journal_entry_linksの汎用トラバーサル」参照)。
 */
export function JournalEntryDetailScreen({
  entryId,
  journalEntryRepository,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onBack,
  onDeleted,
}: JournalEntryDetailScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = () => {
    void Promise.all([
      Promise.resolve(journalEntryRepository.findById(entryId)),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
    ]).then(async ([entry, accounts, projects, householdMembers, counterparties, allEntries]) => {
      if (entry === null) {
        setData(null)
        return
      }
      const linksByEntryId = new Map<number, JournalEntryLink[]>()
      await Promise.all(
        allEntries.map(async (candidate) => {
          const links = await Promise.resolve(journalEntryRepository.listLinksForEntry(candidate.id))
          linksByEntryId.set(candidate.id, links)
        }),
      )
      setData({ entry, accounts, projects, householdMembers, counterparties, allEntries, linksByEntryId })
    })
  }

  useEffect(load, [
    entryId,
    journalEntryRepository,
    accountRepository,
    projectRepository,
    householdMemberRepository,
    counterpartyRepository,
  ])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { entry, accounts, projects, householdMembers, counterparties, allEntries, linksByEntryId } = data
  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? ''
  const projectName = (id: number | null) => (id === null ? null : (projects.find((p) => p.id === id)?.name ?? null))
  const householdMemberName = (id: number | null) =>
    id === null ? null : (householdMembers.find((m) => m.id === id)?.name ?? null)
  const counterpartyName = (id: number | null) =>
    id === null ? null : (counterparties.find((c) => c.id === id)?.name ?? null)

  const entryLinks = linksByEntryId.get(entry.id) ?? []
  const isSplitEntry = entryLinks.some((link) => link.fromEntryId === entry.id && link.linkType === 'allocates')
  const isSettled = entryLinks.some((link) => link.toEntryId === entry.id && link.linkType === 'settles')
  const trails = traceExpenseSplittingHistory(entry, allEntries, linksByEntryId)

  function handleDelete(): void {
    if (isDeleting) return
    setIsDeleting(true)
    void Promise.resolve(journalEntryRepository.delete(entry.id))
      .then(() => onDeleted?.())
      .finally(() => setIsDeleting(false))
  }

  return (
    <div className="journal-entry-detail-screen">
      <h2>{t('entryDetailTitle')}</h2>

      <div className="journal-entry-detail-header">
        <span>{entry.entryDate}</span>
        <span>{entry.memo ?? t('entryNoMemo')}</span>
      </div>

      <ul className="journal-entry-detail-lines">
        {entry.lines.map((line) => (
          <li key={line.id}>
            <span className="journal-entry-detail-line-account">{accountName(line.accountId)}</span>
            <span className="journal-entry-detail-line-amount">{formatCurrency(line.amount, 'JPY')}</span>
            {projectName(line.projectId) !== null && <span>{projectName(line.projectId)}</span>}
            {householdMemberName(line.householdMemberId) !== null && (
              <span>{householdMemberName(line.householdMemberId)}</span>
            )}
            {counterpartyName(line.counterpartyId) !== null && (
              <span>{counterpartyName(line.counterpartyId)}</span>
            )}
          </li>
        ))}
      </ul>

      {isSplitEntry && (
        <div className="journal-entry-detail-cancellation" role="status">
          {isSettled ? (
            <p>{t('splitCancellationAfterSettlementNotice')}</p>
          ) : (
            <button type="button" onClick={handleDelete} disabled={isDeleting}>
              {t('cancelSplitEntry')}
            </button>
          )}
        </div>
      )}

      {trails.length > 0 && (
        <div className="journal-entry-detail-history">
          <h3>{t('splitHistoryTitle')}</h3>
          <ul>
            {trails.map(({ splitEntry, settlementEntries }) => (
              <li key={splitEntry.id}>
                <div>
                  <span>{splitEntry.entryDate}</span>
                  <span>{splitEntry.memo ?? t('entryNoMemo')}</span>
                </div>
                {settlementEntries.length > 0 && (
                  <ul>
                    {settlementEntries.map((settlementEntry) => (
                      <li key={settlementEntry.id}>
                        <span>{settlementEntry.entryDate}</span>
                        <span>{settlementEntry.memo ?? t('entryNoMemo')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
