import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty, CreateCounterpartyInput } from '../../domain/counterparty/Counterparty'
import type { CreateJournalEntryInput, JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type {
  CreateJournalEntryDraftInput,
  JournalEntryDraft,
  UpdateJournalEntryDraftInput,
} from '../../domain/journal/JournalEntryDraft'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import {
  JournalEntryLinesTable,
  MIN_JOURNAL_LINE_COUNT,
  type JournalEntryLineRow,
  type JournalEntryLinesTableMasterData,
} from './JournalEntryLinesTable'
import {
  createEmptyJournalEntryFormLine,
  fromJournalEntryDraftLine,
  hasNonPositiveAmountInput,
  toJournalEntryDraftLineInput,
  toJournalLineInput,
  type JournalEntryFormLine,
} from './journalEntryFormLine'
import './JournalEntryForm.css'

const DRAFT_SAVE_DEBOUNCE_MS = 2000

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
interface JournalEntryCreator {
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

/**
 * journalEntryDraft RPC API(RepositoryRegistry.journalEntryDraft、docs/decisions.md
 * 「RPC越しに渡せないRepositoryインスタンス引数は…」参照)の構造的部分型。confirmは
 * journalEntryRepositoryを引数に取らない縮小シグネチャで公開されている。
 */
export interface JournalEntryDraftClient {
  create(input: CreateJournalEntryDraftInput): JournalEntryDraft | Promise<JournalEntryDraft>
  update(
    id: number,
    input: UpdateJournalEntryDraftInput,
  ): JournalEntryDraft | Promise<JournalEntryDraft>
  confirm(id: number): JournalEntry | Promise<JournalEntry>
}

export interface JournalEntryFormProps {
  accountRepository: AccountFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  journalEntryRepository: JournalEntryCreator
  journalEntryDraftRepository: JournalEntryDraftClient
  /** 下書き一覧画面から再開する場合に渡す。省略時は新規作成として開始する */
  initialDraft?: JournalEntryDraft | null
  onComplete: (entry: JournalEntry) => void
  onBack: () => void
  /** 日付未入力時の初期値(YYYY-MM-DD)。省略時は本日の日付を使う */
  today?: string
  /** テスト用に自動保存のデバウンス時間を注入できるようにする。省略時はDRAFT_SAVE_DEBOUNCE_MS */
  draftSaveDebounceMs?: number
}

type FormLineState = JournalEntryLineRow
type MasterData = JournalEntryLinesTableMasterData

/**
 * マニュアル仕訳入力フォーム(計画Issue #32、docs/domain/journal.md 1章)。
 * 2行以上の明細(複合仕訳)を入力でき、借方/貸方合計・差額をリアルタイム表示する
 * (あくまで入力支援であり、貸借バランスの正式な検証はJournalEntryRepositoryに委ねる、
 * docs/architecture.md 12章)。入力中の内容はフィールド変更のたびにデバウンスして
 * journal_entry_draftsへ自動保存する(何も編集していない間は下書きを作成しない)。
 * 確定操作では、保留中の自動保存を確定内容で同期させたうえでjournalEntryDraft.confirm
 * を呼び出し、下書きをjournal_entries/journal_linesへ変換する。下書きが存在しない
 * (未編集のまま確定した)場合はjournalEntryRepository.createを直接呼び出す。
 */
export function JournalEntryForm({
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  journalEntryDraftRepository,
  initialDraft,
  onComplete,
  onBack,
  today,
  draftSaveDebounceMs,
}: JournalEntryFormProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')

  const lineKeyRef = useRef(0)
  const createLineState = (line?: JournalEntryFormLine): FormLineState => {
    lineKeyRef.current += 1
    return { key: lineKeyRef.current, line: line ?? createEmptyJournalEntryFormLine() }
  }

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [entryDateInput, setEntryDateInput] = useState(
    () => initialDraft?.entryDate ?? today ?? new Date().toISOString().slice(0, 10),
  )
  const [memoInput, setMemoInput] = useState(() => initialDraft?.memo ?? '')
  /**
   * 起票者(docs/domain/journal.md 1.1、計画Issue #88)。初期値はinitialDraftの値を
   * 引き継ぎ、無ければmasterData読み込み完了時に世帯メンバー一覧の先頭を既定値として
   * 補う(seedDefaultHouseholdMemberにより最低1件は存在する想定、下記useEffect参照)。
   */
  const [headerHouseholdMemberId, setHeaderHouseholdMemberId] = useState<number | null>(
    () => initialDraft?.householdMemberId ?? null,
  )
  const [lineStates, setLineStates] = useState<FormLineState[]>(() =>
    initialDraft && initialDraft.lines.length > 0
      ? initialDraft.lines.map((draftLine) => createLineState(fromJournalEntryDraftLine(draftLine)))
      : [
          createLineState({ ...createEmptyJournalEntryFormLine(), side: 'debit' }),
          createLineState({ ...createEmptyJournalEntryFormLine(), side: 'credit' }),
        ],
  )
  const [draftId, setDraftId] = useState<number | null>(initialDraft?.id ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draftIdRef = useRef(draftId)
  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])

  const hasUserEditedRef = useRef(false)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void Promise.all([
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(([accounts, projects, householdMembers, counterparties]) => {
      setMasterData({ accounts, projects, householdMembers, counterparties })
      setHeaderHouseholdMemberId((current) => current ?? householdMembers[0]?.id ?? null)
    })
  }, [accountRepository, projectRepository, householdMemberRepository, counterpartyRepository])

  function buildDraftInput(): CreateJournalEntryDraftInput & UpdateJournalEntryDraftInput {
    return {
      entryDate: entryDateInput === '' ? null : entryDateInput,
      memo: memoInput === '' ? null : memoInput,
      householdMemberId: headerHouseholdMemberId,
      lines: lineStates.map((state) => toJournalEntryDraftLineInput(state.line)),
    }
  }

  useEffect(() => {
    if (!hasUserEditedRef.current) return undefined

    const timer = setTimeout(() => {
      pendingTimerRef.current = null
      void saveDraft()
    }, draftSaveDebounceMs ?? DRAFT_SAVE_DEBOUNCE_MS)
    pendingTimerRef.current = timer

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryDateInput, memoInput, headerHouseholdMemberId, lineStates])

  async function saveDraft(): Promise<void> {
    const input = buildDraftInput()
    if (draftIdRef.current === null) {
      const created = await journalEntryDraftRepository.create(input)
      draftIdRef.current = created.id
      setDraftId(created.id)
    } else {
      await journalEntryDraftRepository.update(draftIdRef.current, input)
    }
  }

  function markEdited() {
    hasUserEditedRef.current = true
  }

  /**
   * 取引先セレクトの「+ 新規取引先を追加」から呼ばれる(CounterpartyQuickAddSelect、
   * StatementImportReviewScreenと同じ設計)。作成した取引先をmasterData.counterpartiesに
   * 追加し、以降すべての行の選択肢に即座に反映されるようにする(再フェッチ不要)。
   */
  async function createCounterparty(name: string): Promise<Counterparty> {
    const created = await Promise.resolve(counterpartyRepository.create({ name }))
    setMasterData((prev) => (prev === null ? prev : { ...prev, counterparties: [...prev.counterparties, created] }))
    return created
  }

  function updateLine(key: number, updater: (line: JournalEntryFormLine) => JournalEntryFormLine) {
    markEdited()
    setLineStates((prev) => prev.map((state) => (state.key === key ? { key, line: updater(state.line) } : state)))
  }

  function addLine(side: JournalLineSide) {
    markEdited()
    setLineStates((prev) => [...prev, createLineState({ ...createEmptyJournalEntryFormLine(), side })])
  }

  function removeLine(key: number) {
    markEdited()
    setLineStates((prev) => (prev.length <= MIN_JOURNAL_LINE_COUNT ? prev : prev.filter((state) => state.key !== key)))
  }

  function cancelPendingSave(): void {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
  }

  /**
   * 「戻る」操作でフォームがアンマウントされるとデバウンス中のuseEffect cleanupが
   * タイマーを無条件にキャンセルするだけで保存されないため、保留中の変更があれば
   * 離脱前に同期的にsaveDraft()を実行してからonBack()を呼ぶ(evaluatorレビュー指摘、
   * 計画Issue #32 Review Attempt 1対応)。
   */
  async function handleBack(): Promise<void> {
    cancelPendingSave()
    if (hasUserEditedRef.current) {
      await saveDraft()
    }
    onBack()
  }

  async function handleConfirm(): Promise<void> {
    cancelPendingSave()

    /**
     * toJournalLineInputは0以下の金額を単に送信対象から除外するだけなので、これを
     * 挟まないと、残りの行だけでたまたま貸借が一致した場合にマイナス金額の行が
     * 気づかれないまま確定されてしまう(ユーザー指摘により追加)。専用メッセージで
     * 確定操作自体をブロックし、Repository呼び出しは行わない。
     */
    if (lineStates.some((state) => hasNonPositiveAmountInput(state.line))) {
      setError(t('negativeAmountError'))
      return
    }

    setSubmitting(true)
    setError(null)

    const lines = lineStates
      .map((state) => toJournalLineInput(state.line))
      .filter((line) => line !== null)

    try {
      let created: JournalEntry
      if (draftIdRef.current === null) {
        created = await journalEntryRepository.create({
          entryDate: entryDateInput,
          memo: memoInput === '' ? null : memoInput,
          householdMemberId: headerHouseholdMemberId as number,
          lines,
        })
      } else {
        await journalEntryDraftRepository.update(draftIdRef.current, buildDraftInput())
        created = await journalEntryDraftRepository.confirm(draftIdRef.current)
      }
      onComplete(created)
    } catch (err) {
      setError(mapErrorToMessage(err))
      setSubmitting(false)
    }
  }

  function mapErrorToMessage(err: unknown): string {
    if (err instanceof UnbalancedJournalEntryError) {
      return err.message.includes('at least 2 lines') ? t('insufficientLinesError') : t('unbalancedError')
    }
    if (err instanceof RestrictedAccountPostingError) {
      return t('restrictedAccountError')
    }
    return t('confirmError')
  }

  if (masterData === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  return (
    <div className="journal-entry-form">
      <h2>{t('journalEntryFormTitle')}</h2>

      <JournalEntryLinesTable
        entryDate={entryDateInput}
        onEntryDateChange={(value) => {
          markEdited()
          setEntryDateInput(value)
        }}
        memo={memoInput}
        onMemoChange={(value) => {
          markEdited()
          setMemoInput(value)
        }}
        headerHouseholdMemberId={headerHouseholdMemberId}
        onHeaderHouseholdMemberChange={(id) => {
          markEdited()
          setHeaderHouseholdMemberId(id)
        }}
        lineRows={lineStates}
        onUpdateLine={updateLine}
        onAddLine={addLine}
        onRemoveLine={removeLine}
        masterData={masterData}
        onCreateCounterparty={createCounterparty}
      />

      {error && <p role="alert">{error}</p>}

      <div>
        <button type="button" onClick={() => void handleBack()}>
          {t('back')}
        </button>
        <button type="button" disabled={submitting} onClick={() => void handleConfirm()}>
          {t('confirm')}
        </button>
      </div>
    </div>
  )
}
