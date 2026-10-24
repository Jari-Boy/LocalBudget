import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty, CreateCounterpartyInput } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import type { Project } from '../../domain/project/Project'
import { traceExpenseSplittingHistory } from '../../domain/expense-splitting/traceExpenseSplittingHistory'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { JournalEntryLinesTable, MIN_JOURNAL_LINE_COUNT, type JournalEntryLineRow } from './JournalEntryLinesTable'
import {
  createEmptyJournalEntryFormLine,
  fromJournalLine,
  hasNonPositiveAmountInput,
  toJournalLineInput,
  type JournalEntryFormLine,
} from './journalEntryFormLine'
import './JournalEntryDetailScreen.css'

interface JournalEntryFinder {
  findById(id: number): JournalEntry | null | Promise<JournalEntry | null>
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  listLinksForEntry(entryId: number): JournalEntryLink[] | Promise<JournalEntryLink[]>
  update(id: number, input: UpdateJournalEntryInput): JournalEntry | Promise<JournalEntry>
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
  create(input: CreateCounterpartyInput): Counterparty | Promise<Counterparty>
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

interface EditState {
  entryDate: string
  memo: string
  lineStates: JournalEntryLineRow[]
}

function buildLineStates(lines: JournalEntry['lines'], lineKeyRef: { current: number }): JournalEntryLineRow[] {
  return lines.map((line) => {
    lineKeyRef.current += 1
    return { key: lineKeyRef.current, line: fromJournalLine(line) }
  })
}

/**
 * 確定済み仕訳詳細画面(計画Issue #40、Lines編集は計画Issue #125)。個々の仕訳明細
 * (科目名・金額・プロジェクト・世帯メンバー・取引先)をJournalEntryLinesTable
 * (JournalEntryFormと共通のLinesテーブルコンポーネント)で編集可能な形で表示し、
 * 行の追加・削除・各セルの編集後に「更新する」操作でJournalEntryRepository.update
 * へ送信する。起票者(householdMemberId)はUpdateJournalEntryInputが対応していないため
 * 変更不可(JournalEntryLinesTableのonHeaderHouseholdMemberChangeを渡さないことで
 * 読み取り専用にする)。この仕訳が割勘仕訳(allocatesリンクのfrom_entry側)である
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
  const [editState, setEditState] = useState<EditState | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const lineKeyRef = useRef(0)

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
        setEditState(null)
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
      setEditState({
        entryDate: entry.entryDate,
        memo: entry.memo ?? '',
        lineStates: buildLineStates(entry.lines, lineKeyRef),
      })
      setUpdateError(null)
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

  if (data === null || editState === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { entry, accounts, projects, householdMembers, counterparties, allEntries, linksByEntryId } = data

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

  function updateEditLine(key: number, updater: (line: JournalEntryFormLine) => JournalEntryFormLine): void {
    setEditState((prev) =>
      prev === null
        ? prev
        : { ...prev, lineStates: prev.lineStates.map((state) => (state.key === key ? { key, line: updater(state.line) } : state)) },
    )
  }

  function addEditLine(): void {
    lineKeyRef.current += 1
    const key = lineKeyRef.current
    setEditState((prev) =>
      prev === null ? prev : { ...prev, lineStates: [...prev.lineStates, { key, line: createEmptyJournalEntryFormLine() }] },
    )
  }

  function removeEditLine(key: number): void {
    setEditState((prev) =>
      prev === null || prev.lineStates.length <= MIN_JOURNAL_LINE_COUNT
        ? prev
        : { ...prev, lineStates: prev.lineStates.filter((state) => state.key !== key) },
    )
  }

  /**
   * 取引先セレクトの「+ 新規取引先を追加」から呼ばれる(JournalEntryFormと同じ設計)。
   * 作成した取引先をdata.counterpartiesに追加し、以降すべての行の選択肢に即座に
   * 反映されるようにする(再フェッチ不要)。
   */
  async function createCounterparty(name: string): Promise<Counterparty> {
    const created = await Promise.resolve(counterpartyRepository.create({ name }))
    setData((prev) => (prev === null ? prev : { ...prev, counterparties: [...prev.counterparties, created] }))
    return created
  }

  function mapErrorToMessage(err: unknown): string {
    if (err instanceof UnbalancedJournalEntryError) {
      return err.message.includes('at least 2 lines') ? t('insufficientLinesError') : t('unbalancedError')
    }
    if (err instanceof RestrictedAccountPostingError) {
      return t('restrictedAccountError')
    }
    return t('updateError')
  }

  /**
   * Linesテーブルでの編集内容を確定済み仕訳へ反映する。JournalEntryRepository.update
   * は貸借バランス検証(assertJournalBalance)を書き込み前に同期的に行うため、失敗時は
   * DBに一切書き込まれない(docs/domain/journal.md 1.3)。エラー時は入力内容を破棄せず
   * editStateをそのまま保持し、ユーザーが値を修正して再試行できるようにする。
   */
  async function handleUpdate(): Promise<void> {
    if (editState === null) return

    if (editState.lineStates.some((state) => hasNonPositiveAmountInput(state.line))) {
      setUpdateError(t('negativeAmountError'))
      return
    }

    setIsUpdating(true)
    setUpdateError(null)

    const lines = editState.lineStates.map((state) => toJournalLineInput(state.line)).filter((line) => line !== null)

    try {
      const updated = await Promise.resolve(
        journalEntryRepository.update(entry.id, {
          entryDate: editState.entryDate,
          memo: editState.memo === '' ? null : editState.memo,
          lines,
        }),
      )
      setData((prev) => (prev === null ? prev : { ...prev, entry: updated }))
      setEditState({
        entryDate: updated.entryDate,
        memo: updated.memo ?? '',
        lineStates: buildLineStates(updated.lines, lineKeyRef),
      })
    } catch (err) {
      setUpdateError(mapErrorToMessage(err))
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="journal-entry-detail-screen">
      <h2>{t('entryDetailTitle')}</h2>

      <JournalEntryLinesTable
        entryDate={editState.entryDate}
        onEntryDateChange={(value) => setEditState((prev) => (prev === null ? prev : { ...prev, entryDate: value }))}
        memo={editState.memo}
        onMemoChange={(value) => setEditState((prev) => (prev === null ? prev : { ...prev, memo: value }))}
        headerHouseholdMemberId={entry.householdMemberId}
        lineRows={editState.lineStates}
        onUpdateLine={updateEditLine}
        onAddLine={addEditLine}
        onRemoveLine={removeEditLine}
        masterData={{ accounts, projects, householdMembers, counterparties }}
        onCreateCounterparty={createCounterparty}
      />

      {updateError && <p role="alert">{updateError}</p>}

      <button type="button" disabled={isUpdating} onClick={() => void handleUpdate()}>
        {t('updateEntry')}
      </button>

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
