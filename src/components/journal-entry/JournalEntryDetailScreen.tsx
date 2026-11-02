import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty, CreateCounterpartyInput } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry, JournalLineInput, JournalLineSide, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import type { JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { Project } from '../../domain/project/Project'
import { hasAnySettlementActivity } from '../../domain/expense-splitting/hasAnySettlementActivity'
import { isExpenseSplitEntry } from '../../domain/expense-splitting/isExpenseSplitEntry'
import { traceExpenseSplittingHistory } from '../../domain/expense-splitting/traceExpenseSplittingHistory'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { JournalEntryLinesTable, type JournalEntryLineRow } from './JournalEntryLinesTable'
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
  update(id: number, input: UpdateJournalEntryInput): JournalEntry | Promise<JournalEntry>
  delete(id: number): void | Promise<void>
}
interface JournalEntryLinkGroupFinder {
  findAllMemberships(): JournalEntryLinkGroupMembership[] | Promise<JournalEntryLinkGroupMembership[]>
  joinOrCreateGroups(
    anchorEntryIds: readonly number[],
    newEntryIds: readonly number[],
  ): void | Promise<void>
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
  journalEntryLinkGroupRepository: JournalEntryLinkGroupFinder
  accountRepository: AccountFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  onBack: () => void
  /** 精算前の割勘仕訳を取り消し(物理削除)した後に呼ばれる */
  onDeleted?: () => void
  /** 「関連する仕訳」一覧のいずれかの行を選んだ際に呼ばれる(その仕訳の詳細画面への遷移を想定) */
  onSelectRelatedEntry?: (entry: JournalEntry) => void
}

interface LoadedData {
  entry: JournalEntry
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
  allEntries: JournalEntry[]
  relatedEntryIdsByEntryId: Map<number, Set<number>>
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
 * 読み取り専用にする)。この仕訳が割勘仕訳である場合、精算済みかどうかに応じて取り消し導線
 * (精算前は物理削除、精算後は返金案内)を出し分ける。この仕訳が元の支出仕訳である場合、
 * そこから生まれた割勘・精算の履歴(traceExpenseSplittingHistory、docs/domain/
 * expense-splitting.md 1.5節)を表示する。
 *
 * 「関連する仕訳」一覧(計画Issue #138)は、journal_entry_links(行対行のハード検証、計画Issue
 * #132・#133で残高計算・消込検証の役割を失い完全撤廃)に代わる関連仕訳グループ(多対多、
 * 表示専用)に基づく。この仕訳が所属する全グループ分の関連仕訳を合算して一覧表示し、
 * 既存の仕訳を検索して新たに関連付ける操作(手動でのグループ作成/参加、
 * journalEntryLinkGroupRepository.joinOrCreateGroups)もここから行える。かつて存在した
 * リンク削除警告UI(行削除時の2段階ボタン確認フロー)は、journal_entry_links自体の撤廃に伴い
 * 廃止した(関連仕訳グループは明細行ではなく仕訳単位の緩い関連付けであり、仕訳の更新操作で
 * 行が削除されてもグループ所属には影響しないため、警告の前提自体が成立しない)。
 */
export function JournalEntryDetailScreen({
  entryId,
  journalEntryRepository,
  journalEntryLinkGroupRepository,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onBack,
  onDeleted,
  onSelectRelatedEntry,
}: JournalEntryDetailScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [relateTargetId, setRelateTargetId] = useState<number | null>(null)
  const [isRelating, setIsRelating] = useState(false)
  const [relateError, setRelateError] = useState<string | null>(null)
  const lineKeyRef = useRef(0)

  const load = () => {
    void Promise.all([
      Promise.resolve(journalEntryRepository.findById(entryId)),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(journalEntryLinkGroupRepository.findAllMemberships()),
    ]).then(([entry, accounts, projects, householdMembers, counterparties, allEntries, memberships]) => {
      if (entry === null) {
        setData(null)
        setEditState(null)
        return
      }
      setData({
        entry,
        accounts,
        projects,
        householdMembers,
        counterparties,
        allEntries,
        relatedEntryIdsByEntryId: buildRelatedEntryIdsByEntryId(memberships),
      })
      setEditState({
        entryDate: entry.entryDate,
        memo: entry.memo ?? '',
        lineStates: buildLineStates(entry.lines, lineKeyRef),
      })
      setUpdateError(null)
      setRelateTargetId(null)
      setRelateError(null)
    })
  }

  useEffect(load, [
    entryId,
    journalEntryRepository,
    journalEntryLinkGroupRepository,
    accountRepository,
    projectRepository,
    householdMemberRepository,
    counterpartyRepository,
  ])

  if (data === null || editState === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { entry, accounts, projects, householdMembers, counterparties, allEntries, relatedEntryIdsByEntryId } = data

  const isSplitEntry = isExpenseSplitEntry(entry, accounts)
  /**
   * 取り消し導線の安全判定は、settlement_batch_idタグの集計方式(計画Issue #133、
   * hasAnySettlementActivity)で行う。「全ての一時勘定行が精算済み」を要求する
   * isExpenseSplittingEntrySettled(履歴画面向け)ではなく、「少なくとも1件の精算操作が
   * 行われたか」を判定するhasAnySettlementActivityを使う(どちらか一方でも精算が進んだ
   * 割勘仕訳を物理削除すると、既に起票済みの精算仕訳が参照先を失うため)。
   */
  const isSettled = hasAnySettlementActivity(entry, accounts, allEntries.flatMap((e) => e.lines))
  const trails = traceExpenseSplittingHistory(entry, allEntries, accounts, relatedEntryIdsByEntryId)

  const entriesById = new Map(allEntries.map((candidate) => [candidate.id, candidate]))
  const relatedEntries = [...(relatedEntryIdsByEntryId.get(entry.id) ?? [])]
    .map((id) => entriesById.get(id))
    .filter((candidate): candidate is JournalEntry => candidate !== undefined)
  const relateCandidates = allEntries.filter(
    (candidate) => candidate.id !== entry.id && !relatedEntries.some((related) => related.id === candidate.id),
  )

  function handleDelete(): void {
    if (isDeleting) return
    setIsDeleting(true)
    void Promise.resolve(journalEntryRepository.delete(entry.id))
      .then(() => onDeleted?.())
      .finally(() => setIsDeleting(false))
  }

  /**
   * 手動での関連付け(計画Issue #138)。選択した仕訳(relateTargetId)をこの仕訳と関連付ける。
   * この仕訳が既存のグループに所属していればそのグループへ選択した仕訳を参加させ、
   * 所属していなければ両方をメンバーとする新規グループを作成する
   * (JournalEntryLinkGroupRepository.joinOrCreateGroupsの判定、anchor=この仕訳)。
   */
  async function handleRelate(): Promise<void> {
    if (isRelating || relateTargetId === null) return
    setIsRelating(true)
    setRelateError(null)
    try {
      await Promise.resolve(journalEntryLinkGroupRepository.joinOrCreateGroups([entry.id], [relateTargetId]))
      load()
    } catch {
      setRelateError(t('relateEntryError'))
    } finally {
      setIsRelating(false)
    }
  }

  function updateEditLine(key: number, updater: (line: JournalEntryFormLine) => JournalEntryFormLine): void {
    setEditState((prev) =>
      prev === null
        ? prev
        : { ...prev, lineStates: prev.lineStates.map((state) => (state.key === key ? { key, line: updater(state.line) } : state)) },
    )
  }

  function addEditLine(side: JournalLineSide): void {
    lineKeyRef.current += 1
    const key = lineKeyRef.current
    setEditState((prev) =>
      prev === null
        ? prev
        : { ...prev, lineStates: [...prev.lineStates, { key, line: { ...createEmptyJournalEntryFormLine(), side } }] },
    )
  }

  function removeEditLine(key: number): void {
    setEditState((prev) =>
      prev === null ? prev : { ...prev, lineStates: prev.lineStates.filter((state) => state.key !== key) },
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
  async function performUpdate(lines: JournalLineInput[]): Promise<void> {
    if (editState === null) return

    setIsUpdating(true)
    setUpdateError(null)

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

  function handleUpdateClick(): void {
    if (editState === null) return

    if (editState.lineStates.some((state) => hasNonPositiveAmountInput(state.line))) {
      setUpdateError(t('negativeAmountError'))
      return
    }

    const lines = editState.lineStates.map((state) => toJournalLineInput(state.line)).filter((line) => line !== null)
    void performUpdate(lines)
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

      <button type="button" disabled={isUpdating} onClick={handleUpdateClick}>
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

      <div className="journal-entry-detail-related-entries">
        <h3>{t('relatedEntriesTitle')}</h3>
        {relatedEntries.length === 0 ? (
          <p>{t('relatedEntriesEmpty')}</p>
        ) : (
          <ul>
            {relatedEntries.map((relatedEntry) => (
              <li key={relatedEntry.id}>
                <span>{relatedEntry.entryDate}</span>
                <span>{relatedEntry.memo ?? t('entryNoMemo')}</span>
                {onSelectRelatedEntry && (
                  <button type="button" onClick={() => onSelectRelatedEntry(relatedEntry)}>
                    {t('viewRelatedEntry')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="journal-entry-detail-relate-form">
          <label htmlFor="journal-entry-detail-relate-select">{t('relateEntryLabel')}</label>
          <select
            id="journal-entry-detail-relate-select"
            value={relateTargetId ?? ''}
            onChange={(event) => setRelateTargetId(event.target.value === '' ? null : Number(event.target.value))}
          >
            <option value="">{t('unselected')}</option>
            {relateCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.entryDate} {candidate.memo ?? t('entryNoMemo')}
              </option>
            ))}
          </select>
          <button type="button" disabled={relateTargetId === null || isRelating} onClick={() => void handleRelate()}>
            {t('relateEntryButton')}
          </button>
          {relateError !== null && <p role="alert">{relateError}</p>}
        </div>
      </div>

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
