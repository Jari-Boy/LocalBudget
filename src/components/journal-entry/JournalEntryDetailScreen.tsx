import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty, CreateCounterpartyInput } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry, JournalLineInput, JournalLineSide, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import type { JournalEntryLinkGroup, JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { Project } from '../../domain/project/Project'
import { hasAnySettlementActivity } from '../../domain/expense-splitting/hasAnySettlementActivity'
import { isExpenseSplitEntry } from '../../domain/expense-splitting/isExpenseSplitEntry'
import { traceExpenseSplittingHistory } from '../../domain/expense-splitting/traceExpenseSplittingHistory'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { groupRelatedEntriesByLinkGroup } from '../../domain/journal-link-group/groupRelatedEntriesByLinkGroup'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { JournalEntryLinesTable, type JournalEntryLineRow } from './JournalEntryLinesTable'
import { RelatedEntriesDialog } from './RelatedEntriesDialog'
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
  findAllGroups(): JournalEntryLinkGroup[] | Promise<JournalEntryLinkGroup[]>
  joinOrCreateGroups(
    anchorEntryIds: readonly number[],
    newEntryIds: readonly number[],
  ): void | Promise<void>
  renameGroup(linkGroupId: number, name: string | null): void | Promise<void>
  removeMember(linkGroupId: number, journalEntryId: number): void | Promise<void>
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
  memberships: JournalEntryLinkGroupMembership[]
  groups: JournalEntryLinkGroup[]
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
 * 「関連する仕訳」(計画Issue #138)は、journal_entry_links(行対行のハード検証、計画Issue
 * #132・#133で残高計算・消込検証の役割を失い完全撤廃)に代わる関連仕訳グループ(多対多、
 * 表示専用)に基づく。画面右上の「関連仕訳」ボタン(件数表示)から開くダイアログ
 * (RelatedEntriesDialog)に一覧表示する(UIレビューにより、常時画面に表示する専用セクション
 * ではなくボタン起点のダイアログに変更)。1つの仕訳が複数の無関係なグループに同時に所属できる
 * (例: SettlementScreenが複数の割勘バッチを1件の精算仕訳で橋渡しする場合)ため、表示も
 * groupRelatedEntriesByLinkGroupでグループ単位の塊に分けたまま渡す(1本のフラットな一覧に
 * 合算すると、どの仕訳がどのグループの関連か分からなくなるというUIレビューでの指摘への対応)。
 * ボタンの件数バッジはbuildRelatedEntryIdsByEntryIdによる重複排除後の合計(同じ仕訳が複数グループ
 * から見えても1件として数える)。各グループの表示名はダイアログ上でその場編集でき
 * (journalEntryLinkGroupRepository.renameGroup)、未設定時はUI側で「グループN」を表示する
 * (永続化はしない)。既存の仕訳を検索して新たに関連付ける操作(手動でのグループ作成/参加、
 * journalEntryLinkGroupRepository.joinOrCreateGroups)もこのダイアログから行える。かつて存在した
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
  const [isRelatedDialogOpen, setIsRelatedDialogOpen] = useState(false)
  const [isAddingRelatedEntry, setIsAddingRelatedEntry] = useState(false)
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
      Promise.resolve(journalEntryLinkGroupRepository.findAllGroups()),
    ]).then(([entry, accounts, projects, householdMembers, counterparties, allEntries, memberships, groups]) => {
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
        memberships,
        groups,
      })
      setEditState({
        entryDate: entry.entryDate,
        memo: entry.memo ?? '',
        lineStates: buildLineStates(entry.lines, lineKeyRef),
      })
      setUpdateError(null)
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

  const { entry, accounts, projects, householdMembers, counterparties, allEntries, memberships, groups } = data
  const relatedEntryIdsByEntryId = buildRelatedEntryIdsByEntryId(memberships)

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
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const relatedEntryIds = relatedEntryIdsByEntryId.get(entry.id) ?? new Set<number>()
  const relatedEntryGroups = groupRelatedEntriesByLinkGroup(entry.id, memberships, groupsById, entriesById)
  const relateCandidates = allEntries.filter(
    (candidate) => candidate.id !== entry.id && !relatedEntryIds.has(candidate.id),
  )

  function handleDelete(): void {
    if (isDeleting) return
    setIsDeleting(true)
    void Promise.resolve(journalEntryRepository.delete(entry.id))
      .then(() => onDeleted?.())
      .finally(() => setIsDeleting(false))
  }

  /**
   * 手動での関連付け(計画Issue #138)。関連仕訳ダイアログ(RelatedEntriesDialog)で選んだ仕訳
   * (targetId)をこの仕訳と関連付ける。この仕訳が既存のグループに所属していればそのグループへ
   * 選択した仕訳を参加させ、所属していなければ両方をメンバーとする新規グループを作成する
   * (JournalEntryLinkGroupRepository.joinOrCreateGroupsの判定、anchor=この仕訳)。
   */
  async function handleAddRelatedEntry(targetId: number): Promise<void> {
    if (isAddingRelatedEntry) return
    setIsAddingRelatedEntry(true)
    setRelateError(null)
    try {
      await Promise.resolve(journalEntryLinkGroupRepository.joinOrCreateGroups([entry.id], [targetId]))
      load()
    } catch {
      setRelateError(t('relateEntryError'))
    } finally {
      setIsAddingRelatedEntry(false)
    }
  }

  /**
   * 関連仕訳ダイアログでのグループ名の変更(計画Issue #138、UIレビュー指摘)。失敗時はload()を
   * 呼ばないため、ダイアログの表示は変更前の名前のまま自然に戻る(renameGroup自体は低リスクな
   * 操作であり、専用のエラー表示は設けない)。
   */
  async function handleRenameGroup(groupId: number, name: string | null): Promise<void> {
    try {
      await Promise.resolve(journalEntryLinkGroupRepository.renameGroup(groupId, name))
      load()
    } catch {
      // 失敗時は何もしない(上記JSDoc参照)
    }
  }

  /**
   * 関連仕訳ダイアログでの関連付け解除(計画Issue #138、UIレビュー指摘)。確認ダイアログは置かない
   * (journal_entry_links撤廃時に廃止したリンク削除警告UIと同じ方針で、残高計算に関与しない
   * 緩い関連付けの解除に重い確認は不要と判断)。失敗時はload()を呼ばないため、行は消えずに残る
   * (renameGroupと同じ、専用のエラー表示は設けない)。
   */
  async function handleRemoveRelatedEntry(groupId: number, targetId: number): Promise<void> {
    try {
      await Promise.resolve(journalEntryLinkGroupRepository.removeMember(groupId, targetId))
      load()
    } catch {
      // 失敗時は何もしない(上記JSDoc参照)
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
      <div className="journal-entry-detail-header">
        <h2>{t('entryDetailTitle')}</h2>
        <button
          type="button"
          className="journal-entry-detail-related-entries-trigger"
          onClick={() => setIsRelatedDialogOpen(true)}
        >
          {t('relatedEntriesButtonLabel', { count: relatedEntryIds.size })}
        </button>
      </div>

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

      {isRelatedDialogOpen && (
        <RelatedEntriesDialog
          relatedEntryGroups={relatedEntryGroups}
          relateCandidates={relateCandidates}
          onSelectEntry={(relatedEntry) => {
            setIsRelatedDialogOpen(false)
            onSelectRelatedEntry?.(relatedEntry)
          }}
          onAddEntry={handleAddRelatedEntry}
          onRenameGroup={handleRenameGroup}
          onRemoveEntry={handleRemoveRelatedEntry}
          onClose={() => setIsRelatedDialogOpen(false)}
          isAdding={isAddingRelatedEntry}
          addError={relateError}
        />
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
