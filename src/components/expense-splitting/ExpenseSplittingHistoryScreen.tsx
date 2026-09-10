import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import type { Project } from '../../domain/project/Project'
import { listExpenseSplittingHistory } from '../../domain/expense-splitting/listExpenseSplittingHistory'
import { resolveExpenseSplittingParticipant } from '../../domain/expense-splitting/resolveExpenseSplittingParticipant'
import { isExpenseSplittingEntrySettled } from '../../domain/expense-splitting/isExpenseSplittingEntrySettled'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './ExpenseSplittingHistoryScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  listLinksForEntry(entryId: number): JournalEntryLink[] | Promise<JournalEntryLink[]>
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

export interface ExpenseSplittingHistoryScreenProps {
  journalEntryRepository: JournalEntryFinder
  accountRepository: AccountFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  /** 一覧の行から仕訳詳細画面(既存のJournalEntryDetailScreen)へ遷移するために呼ばれる */
  onSelectEntry: (entry: JournalEntry) => void
  onBack: () => void
}

interface LoadedData {
  entries: JournalEntry[]
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
  linksByEntryId: Map<number, JournalEntryLink[]>
}

interface AdvanceLinesSummary {
  amount: number
  projectId: number | null
}

/**
 * 割勘仕訳が持つ立替金(is_system_managed=trueの資産/負債)行から、表示用の金額・
 * 所属プロジェクトを求める(docs/domain/expense-splitting.md 1.2節)。複数の元仕訳を
 * まとめて1回で割勘した場合(計画Issue #40、mergeExpenseSplittingJournalEntryInputs)、
 * 1件の仕訳が元仕訳ごとに複数の立替金行(資産側・負債側それぞれ)を持つため、単純に
 * 最初の1行を採用すると合計額より少ない金額を表示してしまう。資産側の行が1件以上
 * あればその合計(世帯メンバー間の割勘は資産側・負債側が同額のため資産側で代表できる)、
 * 無ければ負債側の合計(通常発生しないが安全側)を金額とする。プロジェクトIDは全ての
 * 立替金行で同一のため(1回の割勘操作は単一のprojectIdに対して行う)、代表の1件から取得する。
 */
function summarizeAdvanceLines(entry: JournalEntry, accounts: readonly Account[]): AdvanceLinesSummary {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  const linesByCategory = (category: 'asset' | 'liability') =>
    entry.lines.filter((line) => {
      const account = accountsById.get(line.accountId)
      return account?.isSystemManaged === true && account.category === category
    })

  const assetLines = linesByCategory('asset')
  const targetLines = assetLines.length > 0 ? assetLines : linesByCategory('liability')

  return {
    amount: targetLines.reduce((sum, line) => sum + line.amount, 0),
    projectId: targetLines[0]?.projectId ?? null,
  }
}

function resolveParticipantName(
  splitEntry: JournalEntry,
  accounts: readonly Account[],
  householdMembers: readonly HouseholdMember[],
  counterparties: readonly Counterparty[],
): string | null {
  const participant = resolveExpenseSplittingParticipant(splitEntry, accounts)
  if (participant === undefined) return null
  if (participant.householdMemberId !== null) {
    return householdMembers.find((member) => member.id === participant.householdMemberId)?.name ?? null
  }
  if (participant.counterpartyId !== null) {
    return counterparties.find((counterparty) => counterparty.id === participant.counterpartyId)?.name ?? null
  }
  return null
}

/**
 * 割勘履歴一覧画面(計画Issue #110)。個々の元仕訳を事前に把握していなくても、
 * これまでに行われた割勘(allocatesリンクのfrom_entry側の仕訳)を横断的に一覧表示する
 * (docs/domain/expense-splitting.md 1.5節「履歴の閲覧」)。listExpenseSplittingHistory
 * (全仕訳からの履歴一覧構築)・resolveExpenseSplittingParticipant(分担者特定)・
 * isExpenseSplittingEntrySettled(精算状況判定)を組み合わせて表示用データを組み立てる。
 * 一覧の各行から既存のJournalEntryDetailScreenへ遷移でき、そこで「元の支出→割勘→精算」の
 * 詳細な追跡ができる(本画面はあくまで横断的な一覧に徹し、詳細追跡ロジックは再実装しない)。
 */
export function ExpenseSplittingHistoryScreen({
  journalEntryRepository,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onSelectEntry,
  onBack,
}: ExpenseSplittingHistoryScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)

  useEffect(() => {
    void Promise.all([
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(async ([entries, accounts, projects, householdMembers, counterparties]) => {
      const linksByEntryId = new Map<number, JournalEntryLink[]>()
      await Promise.all(
        entries.map(async (entry) => {
          linksByEntryId.set(entry.id, await Promise.resolve(journalEntryRepository.listLinksForEntry(entry.id)))
        }),
      )
      setData({ entries, accounts, projects, householdMembers, counterparties, linksByEntryId })
    })
  }, [
    journalEntryRepository,
    accountRepository,
    projectRepository,
    householdMemberRepository,
    counterpartyRepository,
  ])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { entries, accounts, projects, householdMembers, counterparties, linksByEntryId } = data
  const historyEntries = listExpenseSplittingHistory(entries, linksByEntryId)
  const projectName = (id: number | null) => (id === null ? null : (projects.find((p) => p.id === id)?.name ?? null))

  return (
    <div className="expense-splitting-history-screen">
      <h2>{t('historyTitle')}</h2>

      {historyEntries.length === 0 ? (
        <p>{t('historyEmpty')}</p>
      ) : (
        <ul>
          {historyEntries.map(({ splitEntry, originalEntries }) => {
            const advanceSummary = summarizeAdvanceLines(splitEntry, accounts)
            const participantName = resolveParticipantName(splitEntry, accounts, householdMembers, counterparties)
            const isSettled = isExpenseSplittingEntrySettled(
              splitEntry,
              entries,
              accounts,
              linksByEntryId.get(splitEntry.id) ?? [],
            )
            const originalSummary =
              originalEntries.length === 1
                ? (originalEntries[0].memo ?? t('entryNoMemo'))
                : t('historyOriginalEntriesSummary', { count: originalEntries.length })
            const belongingProjectName = projectName(advanceSummary.projectId)

            return (
              <li key={splitEntry.id}>
                <span>{originalEntries[0].entryDate}</span>
                <span>{originalSummary}</span>
                {participantName !== null && <span>{participantName}</span>}
                <span>{formatCurrency(advanceSummary.amount, 'JPY')}</span>
                <span>{isSettled ? t('historySettledLabel') : t('historyUnsettledLabel')}</span>
                {belongingProjectName !== null && <span>{belongingProjectName}</span>}
                <button type="button" onClick={() => onSelectEntry(splitEntry)}>
                  {t('viewEntryDetail')}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
