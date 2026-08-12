import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type {
  Counterparty,
  CounterpartyPattern,
  CreateCounterpartyInput,
  UpdateCounterpartyInput,
} from '../../domain/counterparty/Counterparty'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import './CounterpartyManagementScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}
interface CounterpartyFinder {
  findAll(): Counterparty[] | Promise<Counterparty[]>
}
interface CounterpartyCreator {
  create(input: CreateCounterpartyInput): Counterparty | Promise<Counterparty>
}
interface CounterpartyUpdater {
  update(id: number, input: UpdateCounterpartyInput): Counterparty | Promise<Counterparty>
}
interface CounterpartyDeleter {
  delete(id: number): void | Promise<void>
}
interface CounterpartyDeactivator {
  deactivate(id: number): Counterparty | Promise<Counterparty>
}
interface CounterpartyMerger {
  merge(targetId: number, sourceIds: number[]): void | Promise<void>
}
interface CounterpartyPatternFinder {
  findPatternsByCounterparty(
    counterpartyId: number,
  ): CounterpartyPattern[] | Promise<CounterpartyPattern[]>
}
interface CounterpartyPatternUpdater {
  updatePattern(patternId: number, pattern: string): CounterpartyPattern | Promise<CounterpartyPattern>
}
interface CounterpartyPatternDeleter {
  deletePattern(patternId: number): void | Promise<void>
}

export interface CounterpartyManagementScreenProps {
  counterpartyRepository: CounterpartyFinder &
    CounterpartyCreator &
    CounterpartyUpdater &
    CounterpartyDeleter &
    CounterpartyDeactivator &
    CounterpartyMerger &
    CounterpartyPatternFinder &
    CounterpartyPatternUpdater &
    CounterpartyPatternDeleter
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  onBack: () => void
}

interface LoadedData {
  counterparties: Counterparty[]
  eligibleAccounts: Account[]
  accountNameById: Map<number, string>
  /** docs/domain/counterparties.md 1.5節の削除可否判定に使う、取引先idごとの紐づく仕訳明細件数 */
  journalLineCountByCounterpartyId: Map<number, number>
  /** 計画Issue #85: 取引先idごとの登録済み学習パターン(件数表示・展開一覧の両方に使う) */
  patternsByCounterpartyId: Map<number, CounterpartyPattern[]>
}

/** nullは非表示、'create'は新規作成フォーム、number(id)は該当取引先の編集フォームを表す */
type FormMode = 'create' | number | null

/**
 * 取引先管理画面(計画Issue #38)。登録済み取引先の一覧表示・新規作成・編集
 * (名称・default_account_id)・削除/非アクティブ化・統合を、単一画面+
 * インラインフォームで提供する(docs/domain/counterparties.md 2章・1.5・1.5a節)。
 */
export function CounterpartyManagementScreen({
  counterpartyRepository,
  accountRepository,
  journalEntryRepository,
  onBack,
}: CounterpartyManagementScreenProps) {
  const { t } = useTranslation('counterparty')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [defaultAccountInput, setDefaultAccountInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** 作成・編集・削除・非アクティブ化・統合確定のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(new Set())
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [mergeResult, setMergeResult] = useState<{ targetName: string; sourceNames: string[] } | null>(
    null,
  )
  const [expandedPatternIds, setExpandedPatternIds] = useState<Set<number>>(new Set())
  const [editingPatternId, setEditingPatternId] = useState<number | null>(null)
  const [patternInput, setPatternInput] = useState('')

  const load = () => {
    void Promise.all([
      Promise.resolve(counterpartyRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
    ]).then(async ([counterparties, accounts, entries]) => {
      const journalLineCountByCounterpartyId = new Map<number, number>()
      for (const entry of entries) {
        for (const line of entry.lines) {
          if (line.counterpartyId === null) continue
          journalLineCountByCounterpartyId.set(
            line.counterpartyId,
            (journalLineCountByCounterpartyId.get(line.counterpartyId) ?? 0) + 1,
          )
        }
      }
      const patternEntries = await Promise.all(
        counterparties.map(
          async (counterparty) =>
            [
              counterparty.id,
              await Promise.resolve(counterpartyRepository.findPatternsByCounterparty(counterparty.id)),
            ] as const,
        ),
      )
      setData({
        counterparties,
        eligibleAccounts: accounts.filter((account) => isCounterpartyEligibleCategory(account.category)),
        accountNameById: new Map(accounts.map((account) => [account.id, account.name])),
        journalLineCountByCounterpartyId,
        patternsByCounterpartyId: new Map(patternEntries),
      })
    })
  }

  useEffect(load, [counterpartyRepository, accountRepository, journalEntryRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const openCreateForm = () => {
    setNameInput('')
    setDefaultAccountInput('')
    setError(null)
    setFormMode('create')
  }

  const openEditForm = (counterparty: Counterparty) => {
    setNameInput(counterparty.name)
    setDefaultAccountInput(counterparty.defaultAccountId === null ? '' : String(counterparty.defaultAccountId))
    setError(null)
    setFormMode(counterparty.id)
  }

  const closeForm = () => {
    setFormMode(null)
    setError(null)
  }

  const submitForm = () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    const defaultAccountId = defaultAccountInput === '' ? null : Number(defaultAccountInput)
    const request =
      formMode === 'create'
        ? Promise.resolve(
            counterpartyRepository.create({
              name: nameInput,
              ...(defaultAccountId === null ? {} : { defaultAccountId }),
            }),
          )
        : Promise.resolve(
            counterpartyRepository.update(formMode as number, { name: nameInput, defaultAccountId }),
          )

    void request
      .then(() => {
        closeForm()
        load()
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deleteCounterparty = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(counterpartyRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateCounterparty = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(counterpartyRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  const toggleMergeSource = (id: number) => {
    setMergeResult(null)
    setSelectedSourceIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    if (mergeTargetId === String(id)) {
      setMergeTargetId('')
    }
  }

  const executeMerge = () => {
    if (isSubmitting) return
    const targetId = Number(mergeTargetId)
    const target = data.counterparties.find((counterparty) => counterparty.id === targetId)
    const sources = data.counterparties.filter((counterparty) => selectedSourceIds.has(counterparty.id))
    if (!target || sources.length === 0) return

    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(
      counterpartyRepository.merge(
        targetId,
        sources.map((source) => source.id),
      ),
    )
      .then(() => {
        setMergeResult({ targetName: target.name, sourceNames: sources.map((source) => source.name) })
        setSelectedSourceIds(new Set())
        setMergeTargetId('')
        setConfirmingMerge(false)
        load()
      })
      .catch(() => {
        setConfirmingMerge(false)
        setError(t('mergeError'))
      })
      .finally(() => setIsSubmitting(false))
  }

  const togglePatterns = (counterpartyId: number) => {
    setExpandedPatternIds((prev) => {
      const next = new Set(prev)
      if (next.has(counterpartyId)) {
        next.delete(counterpartyId)
      } else {
        next.add(counterpartyId)
      }
      return next
    })
  }

  const startPatternEdit = (pattern: CounterpartyPattern) => {
    setError(null)
    setEditingPatternId(pattern.id)
    setPatternInput(pattern.pattern)
  }

  const cancelPatternEdit = () => {
    setEditingPatternId(null)
    setPatternInput('')
  }

  const savePattern = () => {
    if (isSubmitting || editingPatternId === null) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(counterpartyRepository.updatePattern(editingPatternId, patternInput))
      .then(() => {
        setEditingPatternId(null)
        setPatternInput('')
        load()
      })
      .catch(() => setError(t('patternSaveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deletePattern = (patternId: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(counterpartyRepository.deletePattern(patternId))
      .then(load)
      .catch(() => setError(t('patternDeleteError')))
      .finally(() => setIsSubmitting(false))
  }

  return (
    <div className="counterparty-management-screen">
      <h2>{t('counterpartyListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.counterparties.length === 0 ? (
        <p>{t('counterpartyListEmpty')}</p>
      ) : (
        <ul>
          {data.counterparties.map((counterparty) => {
            const journalLineCount = data.journalLineCountByCounterpartyId.get(counterparty.id) ?? 0
            const patterns = data.patternsByCounterpartyId.get(counterparty.id) ?? []
            const patternsExpanded = expandedPatternIds.has(counterparty.id)
            return (
              <li key={counterparty.id}>
                <div className="counterparty-list-row">
                  <input
                    type="checkbox"
                    aria-label={counterparty.name}
                    checked={selectedSourceIds.has(counterparty.id)}
                    onChange={() => toggleMergeSource(counterparty.id)}
                  />
                  <span className="counterparty-list-name">
                    {counterparty.name}
                    {counterparty.defaultAccountId !== null && (
                      <span className="counterparty-list-default-account">
                        {data.accountNameById.get(counterparty.defaultAccountId)}
                      </span>
                    )}
                    {!counterparty.isActive && (
                      <span className="counterparty-list-inactive">{t('inactiveLabel')}</span>
                    )}
                  </span>
                  <span className="counterparty-list-actions">
                    <button
                      type="button"
                      onClick={() => togglePatterns(counterparty.id)}
                      aria-expanded={patternsExpanded}
                    >
                      {t('patternCount', { count: patterns.length })}
                    </button>
                    <button type="button" onClick={() => openEditForm(counterparty)} disabled={isSubmitting}>
                      {t('editButton')}
                    </button>
                    {journalLineCount === 0 && (
                      <button
                        type="button"
                        onClick={() => deleteCounterparty(counterparty.id)}
                        disabled={isSubmitting}
                      >
                        {t('deleteButton')}
                      </button>
                    )}
                    {counterparty.isActive && (
                      <button
                        type="button"
                        onClick={() => deactivateCounterparty(counterparty.id)}
                        disabled={isSubmitting}
                      >
                        {t('deactivateButton')}
                      </button>
                    )}
                  </span>
                </div>

                {patternsExpanded && (
                  <div className="counterparty-pattern-panel">
                    {patterns.length === 0 ? (
                      <p>{t('patternListEmpty')}</p>
                    ) : (
                      patterns.map((pattern) => (
                        <div key={pattern.id} className="counterparty-pattern-row">
                          {editingPatternId === pattern.id ? (
                            <>
                              <input
                                aria-label={t('patternInputLabel')}
                                type="text"
                                value={patternInput}
                                onChange={(event) => setPatternInput(event.target.value)}
                              />
                              <button
                                type="button"
                                onClick={savePattern}
                                disabled={patternInput.trim() === '' || isSubmitting}
                              >
                                {t('patternSaveSubmit')}
                              </button>
                              <button type="button" onClick={cancelPatternEdit} disabled={isSubmitting}>
                                {t('cancel')}
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="counterparty-pattern-text">{pattern.pattern}</span>
                              <button
                                type="button"
                                onClick={() => startPatternEdit(pattern)}
                                disabled={isSubmitting}
                              >
                                {t('patternEditButton')}
                              </button>
                              <button
                                type="button"
                                onClick={() => deletePattern(pattern.id)}
                                disabled={isSubmitting}
                              >
                                {t('patternDeleteButton')}
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {formMode === null ? (
        <button type="button" onClick={openCreateForm} disabled={isSubmitting}>
          {t('addButton')}
        </button>
      ) : (
        <div className="counterparty-form">
          <label htmlFor="counterparty-name">{t('nameLabel')}</label>
          <input
            id="counterparty-name"
            type="text"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />

          <label htmlFor="counterparty-default-account">{t('defaultAccountLabel')}</label>
          <select
            id="counterparty-default-account"
            value={defaultAccountInput}
            onChange={(event) => setDefaultAccountInput(event.target.value)}
          >
            <option value="">{t('defaultAccountNone')}</option>
            {data.eligibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          <div className="counterparty-form-actions">
            <button
              type="button"
              onClick={submitForm}
              disabled={nameInput.trim() === '' || isSubmitting}
            >
              {formMode === 'create' ? t('createSubmit') : t('saveSubmit')}
            </button>
            <button type="button" onClick={closeForm} disabled={isSubmitting}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {data.counterparties.length >= 2 && (
        <div className="counterparty-merge-section">
          <h3>{t('mergeSectionTitle')}</h3>
          <label htmlFor="counterparty-merge-target">{t('mergeTargetLabel')}</label>
          <select
            id="counterparty-merge-target"
            value={mergeTargetId}
            onChange={(event) => setMergeTargetId(event.target.value)}
          >
            <option value="">{t('mergeTargetPlaceholder')}</option>
            {data.counterparties
              .filter((counterparty) => !selectedSourceIds.has(counterparty.id))
              .map((counterparty) => (
                <option key={counterparty.id} value={counterparty.id}>
                  {counterparty.name}
                </option>
              ))}
          </select>

          {!confirmingMerge ? (
            <button
              type="button"
              onClick={() => setConfirmingMerge(true)}
              disabled={selectedSourceIds.size === 0 || mergeTargetId === '' || isSubmitting}
            >
              {t('mergeSubmit')}
            </button>
          ) : (
            <div className="counterparty-merge-confirm">
              <p>{t('mergeConfirmTitle')}</p>
              <button type="button" onClick={executeMerge} disabled={isSubmitting}>
                {t('mergeConfirmSubmit')}
              </button>
              <button type="button" onClick={() => setConfirmingMerge(false)} disabled={isSubmitting}>
                {t('cancel')}
              </button>
            </div>
          )}

          {mergeResult !== null && (
            <p role="status" aria-label={t('mergeResultLabel')}>
              {t('mergeResultMessage', {
                target: mergeResult.targetName,
                sources: mergeResult.sourceNames.join('、'),
              })}
            </p>
          )}
        </div>
      )}

      <button type="button" onClick={onBack} disabled={isSubmitting}>
        {t('back')}
      </button>
    </div>
  )
}
