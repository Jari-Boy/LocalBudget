import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CreateJournalEntryInput, JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type {
  CreateJournalEntryDraftInput,
  JournalEntryDraft,
  UpdateJournalEntryDraftInput,
} from '../../domain/journal/JournalEntryDraft'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { calculateJournalLineTotals } from './journalLineTotals'
import {
  createEmptyJournalEntryFormLine,
  fromJournalEntryDraftLine,
  isCounterpartyEligibleCategory,
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

interface FormLineState {
  key: number
  line: JournalEntryFormLine
}

interface MasterData {
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
}

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
  const [lineStates, setLineStates] = useState<FormLineState[]>(() =>
    initialDraft && initialDraft.lines.length > 0
      ? initialDraft.lines.map((draftLine) => createLineState(fromJournalEntryDraftLine(draftLine)))
      : [createLineState(), createLineState()],
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
    })
  }, [accountRepository, projectRepository, householdMemberRepository, counterpartyRepository])

  function buildDraftInput(): CreateJournalEntryDraftInput & UpdateJournalEntryDraftInput {
    return {
      entryDate: entryDateInput === '' ? null : entryDateInput,
      memo: memoInput === '' ? null : memoInput,
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
  }, [entryDateInput, memoInput, lineStates])

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

  function updateLine(key: number, updater: (line: JournalEntryFormLine) => JournalEntryFormLine) {
    markEdited()
    setLineStates((prev) => prev.map((state) => (state.key === key ? { key, line: updater(state.line) } : state)))
  }

  function addLine() {
    markEdited()
    setLineStates((prev) => [...prev, createLineState()])
  }

  function removeLine(key: number) {
    markEdited()
    setLineStates((prev) => (prev.length <= 2 ? prev : prev.filter((state) => state.key !== key)))
  }

  async function handleConfirm(): Promise<void> {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
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

  const totals = calculateJournalLineTotals(lineStates.map((state) => state.line))

  return (
    <div className="journal-entry-form">
      <h2>{t('journalEntryFormTitle')}</h2>

      <div>
        <label htmlFor="journal-entry-date">{t('entryDateLabel')}</label>
        <input
          id="journal-entry-date"
          type="date"
          value={entryDateInput}
          onChange={(event) => {
            markEdited()
            setEntryDateInput(event.target.value)
          }}
        />
      </div>

      <div>
        <label htmlFor="journal-entry-memo">{t('memoLabel')}</label>
        <input
          id="journal-entry-memo"
          type="text"
          placeholder={t('memoPlaceholder')}
          value={memoInput}
          onChange={(event) => {
            markEdited()
            setMemoInput(event.target.value)
          }}
        />
      </div>

      {lineStates.map((state, index) => {
        const selectedAccount = masterData.accounts.find((account) => account.id === state.line.accountId)
        const showCounterparty =
          selectedAccount !== undefined && isCounterpartyEligibleCategory(selectedAccount.category)
        const idPrefix = `journal-entry-line-${state.key}`

        return (
          <fieldset key={state.key}>
            <legend>{t('lineGroupLabel', { index: index + 1 })}</legend>

            <label htmlFor={`${idPrefix}-account`}>{t('lineAccountLabel')}</label>
            <select
              id={`${idPrefix}-account`}
              value={state.line.accountId ?? ''}
              onChange={(event) => {
                const accountId = event.target.value === '' ? null : Number(event.target.value)
                const account = masterData.accounts.find((candidate) => candidate.id === accountId)
                updateLine(state.key, (line) => ({
                  ...line,
                  accountId,
                  counterpartyId:
                    account !== undefined && isCounterpartyEligibleCategory(account.category)
                      ? line.counterpartyId
                      : null,
                }))
              }}
            >
              <option value="">{t('unselected')}</option>
              {masterData.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>

            <label htmlFor={`${idPrefix}-side`}>{t('lineSideLabel')}</label>
            <select
              id={`${idPrefix}-side`}
              value={state.line.side ?? ''}
              onChange={(event) =>
                updateLine(state.key, (line) => ({
                  ...line,
                  side: event.target.value === '' ? null : (event.target.value as JournalLineSide),
                }))
              }
            >
              <option value="">{t('unselected')}</option>
              <option value="debit">{t('sideDebit')}</option>
              <option value="credit">{t('sideCredit')}</option>
            </select>

            <label htmlFor={`${idPrefix}-amount`}>{t('lineAmountLabel')}</label>
            <input
              id={`${idPrefix}-amount`}
              type="number"
              value={state.line.amountInput}
              onChange={(event) =>
                updateLine(state.key, (line) => ({ ...line, amountInput: event.target.value }))
              }
            />

            <label htmlFor={`${idPrefix}-project`}>{t('lineProjectLabel')}</label>
            <select
              id={`${idPrefix}-project`}
              value={state.line.projectId ?? ''}
              onChange={(event) =>
                updateLine(state.key, (line) => ({
                  ...line,
                  projectId: event.target.value === '' ? null : Number(event.target.value),
                }))
              }
            >
              <option value="">{t('unselected')}</option>
              {masterData.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <label htmlFor={`${idPrefix}-member`}>{t('lineHouseholdMemberLabel')}</label>
            <select
              id={`${idPrefix}-member`}
              value={state.line.householdMemberId ?? ''}
              onChange={(event) =>
                updateLine(state.key, (line) => ({
                  ...line,
                  householdMemberId: event.target.value === '' ? null : Number(event.target.value),
                }))
              }
            >
              <option value="">{t('unselected')}</option>
              {masterData.householdMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>

            {showCounterparty && (
              <>
                <label htmlFor={`${idPrefix}-counterparty`}>{t('lineCounterpartyLabel')}</label>
                <select
                  id={`${idPrefix}-counterparty`}
                  value={state.line.counterpartyId ?? ''}
                  onChange={(event) =>
                    updateLine(state.key, (line) => ({
                      ...line,
                      counterpartyId: event.target.value === '' ? null : Number(event.target.value),
                    }))
                  }
                >
                  <option value="">{t('unselected')}</option>
                  {masterData.counterparties.map((counterparty) => (
                    <option key={counterparty.id} value={counterparty.id}>
                      {counterparty.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <button type="button" onClick={() => removeLine(state.key)} disabled={lineStates.length <= 2}>
              {t('removeLine')}
            </button>
          </fieldset>
        )
      })}

      <button type="button" onClick={addLine}>
        {t('addLine')}
      </button>

      <div className="journal-entry-totals">
        <div>
          <span>{t('debitTotalLabel')}</span>
          <span>{formatCurrency(totals.debitTotal, 'JPY')}</span>
        </div>
        <div>
          <span>{t('creditTotalLabel')}</span>
          <span>{formatCurrency(totals.creditTotal, 'JPY')}</span>
        </div>
        <div>
          <span>{t('differenceLabel')}</span>
          <span>{formatCurrency(Math.abs(totals.difference), 'JPY')}</span>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div>
        <button type="button" onClick={onBack}>
          {tCommon('close')}
        </button>
        <button type="button" disabled={submitting} onClick={() => void handleConfirm()}>
          {t('confirm')}
        </button>
      </div>
    </div>
  )
}
