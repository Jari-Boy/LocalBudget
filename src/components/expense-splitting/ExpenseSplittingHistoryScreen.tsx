import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { listExpenseSplittingHistory } from '../../domain/expense-splitting/listExpenseSplittingHistory'
import { resolveExpenseSplittingParticipant } from '../../domain/expense-splitting/resolveExpenseSplittingParticipant'
import { isExpenseSplittingEntrySettled } from '../../domain/expense-splitting/isExpenseSplittingEntrySettled'
import { hasAnySettlementActivity } from '../../domain/expense-splitting/hasAnySettlementActivity'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './ExpenseSplittingHistoryScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  delete(id: number): void | Promise<void>
}
interface JournalEntryLinkGroupFinder {
  findAllMemberships(): JournalEntryLinkGroupMembership[] | Promise<JournalEntryLinkGroupMembership[]>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface SettlementBatchFinder {
  findAll(): SettlementBatch[] | Promise<SettlementBatch[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface CounterpartyFinder {
  findAll(): Counterparty[] | Promise<Counterparty[]>
}

export interface ExpenseSplittingHistoryScreenProps {
  journalEntryRepository: JournalEntryFinder
  journalEntryLinkGroupRepository: JournalEntryLinkGroupFinder
  accountRepository: AccountFinder
  settlementBatchRepository: SettlementBatchFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  /** 一覧の行から仕訳詳細画面(既存のJournalEntryDetailScreen)へ遷移するために呼ばれる */
  onSelectEntry: (entry: JournalEntry) => void
  onBack: () => void
}

interface LoadedData {
  entries: JournalEntry[]
  accounts: Account[]
  settlementBatches: SettlementBatch[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
  relatedEntryIdsByEntryId: Map<number, Set<number>>
}

interface AdvanceLinesSummary {
  amount: number
  settlementBatchId: number | null
}

/**
 * 割勘仕訳が持つ立替金(is_system_managed=trueの資産/負債)行から、表示用の金額・
 * 所属精算バッチを求める(docs/domain/expense-splitting.md 1.2節、計画Issue #133で
 * project_idからsettlement_batch_idへ変更)。複数の元仕訳をまとめて1回で割勘した場合
 * (計画Issue #40、mergeExpenseSplittingJournalEntryInputs)、1件の仕訳が元仕訳ごとに
 * 複数の立替金行(資産側・負債側それぞれ)を持つため、単純に最初の1行を採用すると合計額
 * より少ない金額を表示してしまう。資産側の行が1件以上あればその合計(世帯メンバー間の
 * 割勘は資産側・負債側が同額のため資産側で代表できる)、無ければ負債側の合計(通常発生
 * しないが安全側)を金額とする。精算バッチIDは全ての立替金行で同一のため(1回の割勘操作は
 * 単一のsettlement_batch_idに対して行う)、代表の1件から取得する。
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
    settlementBatchId: targetLines[0]?.settlementBatchId ?? null,
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
 * 割勘履歴一覧画面(計画Issue #110、計画Issue #139で取り消し導線をJournalEntryDetailScreenから
 * 本画面に移設)。個々の元仕訳を事前に把握していなくても、これまでに行われた割勘(関連仕訳
 * グループ+科目構成で割勘仕訳と判定できる仕訳、計画Issue #138)を横断的に一覧表示する
 * (docs/domain/expense-splitting.md 1.5節「履歴の閲覧」)。listExpenseSplittingHistory
 * (全仕訳からの履歴一覧構築)・resolveExpenseSplittingParticipant(分担者特定)・
 * isExpenseSplittingEntrySettled(精算状況判定、一覧の精算済み/未精算バッジ用)を組み合わせて
 * 表示用データを組み立てる。一覧の各行から既存のJournalEntryDetailScreenへ遷移でき、そこで
 * 「元の支出→割勘→精算」の詳細な追跡ができる(本画面はあくまで横断的な一覧に徹し、詳細追跡
 * ロジックは再実装しない)。
 *
 * 取り消し(物理削除)導線は、各行に「この割勘を取り消す」ボタンとして表示する。安全判定は
 * hasAnySettlementActivity(少なくとも1件の精算操作が行われたか)で行う(JournalEntryDetailScreen
 * が使っていたものと同じ判定。「全ての一時勘定行が精算済み」を要求するisExpenseSplittingEntrySettled
 * (本画面の精算済み/未精算バッジ用)とは別物で、どちらか一方でも精算が進んだ割勘仕訳を物理削除
 * すると、既に起票済みの精算仕訳が参照先を失うため)。精算が進んでいる場合はボタンの代わりに
 * 返金案内メッセージを表示する。
 */
export function ExpenseSplittingHistoryScreen({
  journalEntryRepository,
  journalEntryLinkGroupRepository,
  accountRepository,
  settlementBatchRepository,
  householdMemberRepository,
  counterpartyRepository,
  onSelectEntry,
  onBack,
}: ExpenseSplittingHistoryScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tJournal } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [cancelingEntryId, setCancelingEntryId] = useState<number | null>(null)
  const [confirmingCancelEntryId, setConfirmingCancelEntryId] = useState<number | null>(null)

  function load() {
    return Promise.all([
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(journalEntryLinkGroupRepository.findAllMemberships()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(settlementBatchRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(([entries, memberships, accounts, settlementBatches, householdMembers, counterparties]) => {
      const relatedEntryIdsByEntryId = buildRelatedEntryIdsByEntryId(memberships)
      setData({ entries, accounts, settlementBatches, householdMembers, counterparties, relatedEntryIdsByEntryId })
    })
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    journalEntryRepository,
    journalEntryLinkGroupRepository,
    accountRepository,
    settlementBatchRepository,
    householdMemberRepository,
    counterpartyRepository,
  ])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { entries, accounts, settlementBatches, householdMembers, counterparties, relatedEntryIdsByEntryId } = data
  const allLines = entries.flatMap((entry) => entry.lines)
  const historyEntries = listExpenseSplittingHistory(entries, accounts, relatedEntryIdsByEntryId)
  const settlementBatchName = (id: number | null) =>
    id === null ? null : (settlementBatches.find((batch) => batch.id === id)?.name ?? null)

  function handleCancel(splitEntryId: number): void {
    if (cancelingEntryId !== null) return
    setCancelingEntryId(splitEntryId)
    void Promise.resolve(journalEntryRepository.delete(splitEntryId))
      .then(() => load())
      .finally(() => {
        setCancelingEntryId(null)
        setConfirmingCancelEntryId(null)
      })
  }

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
            const isSettled = isExpenseSplittingEntrySettled(splitEntry, accounts, allLines)
            const canCancel = !hasAnySettlementActivity(splitEntry, accounts, allLines)
            const originalSummary =
              originalEntries.length === 1
                ? (originalEntries[0].memo ?? t('entryNoMemo'))
                : t('historyOriginalEntriesSummary', { count: originalEntries.length })
            const belongingProjectName = settlementBatchName(advanceSummary.settlementBatchId)

            return (
              <li key={splitEntry.id}>
                {/* listExpenseSplittingHistoryがoriginalEntriesを取引日昇順にソート済みのため、
                    先頭要素は常に「最も古い元の支出」の日付になる(Review Attempt 2指摘対応) */}
                <span>{originalEntries[0].entryDate}</span>
                <span>{originalSummary}</span>
                {participantName !== null && <span>{participantName}</span>}
                <span>{formatCurrency(advanceSummary.amount, 'JPY')}</span>
                <span>{isSettled ? t('historySettledLabel') : t('historyUnsettledLabel')}</span>
                {belongingProjectName !== null && <span>{belongingProjectName}</span>}
                <button type="button" onClick={() => onSelectEntry(splitEntry)}>
                  {t('viewEntryDetail')}
                </button>
                {canCancel ? (
                  confirmingCancelEntryId === splitEntry.id ? (
                    <div className="expense-splitting-history-cancel-warning" role="alert">
                      <p>{tJournal('cancelSplitEntryWarning')}</p>
                      <div className="expense-splitting-history-cancel-warning-actions">
                        <button
                          type="button"
                          onClick={() => setConfirmingCancelEntryId(null)}
                          disabled={cancelingEntryId === splitEntry.id}
                        >
                          {tJournal('cancelButton')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancel(splitEntry.id)}
                          disabled={cancelingEntryId === splitEntry.id}
                        >
                          {tJournal('cancelSplitEntryConfirmButton')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmingCancelEntryId(splitEntry.id)}>
                      {tJournal('cancelSplitEntry')}
                    </button>
                  )
                ) : (
                  <span>{tJournal('splitCancellationAfterSettlementNotice')}</span>
                )}
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
