import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HistoryOperation, UndoPreview } from '../../infrastructure/history/OperationHistory'
import { describeUndoSteps, summarizeImpact } from './historyDisplay'
import './HistoryScreen.css'

type MaybeAsync<T> = T | Promise<T>

/** 履歴画面が使うWorker側の操作履歴API(RepositoryRegistry.history、計画Issue #202) */
export interface HistoryScreenApi {
  list(): MaybeAsync<HistoryOperation[]>
  limit(): MaybeAsync<number>
  previewUndoTo(operationId: number): MaybeAsync<UndoPreview>
  undoTo(operationId: number): MaybeAsync<number>
}

export interface HistoryScreenProps {
  history: HistoryScreenApi
}

/** この件数以上の仕訳に影響する操作には、一覧で注意のタグを付ける */
const LARGE_IMPACT = 50

type Step = 'preview' | 'confirm'

function timeOf(operation: HistoryOperation): string {
  const date = new Date(operation.recordedAt)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * 操作履歴(ロールバック)画面(計画Issue #202、承認済みモックアップ)。履歴はWorkerのメモリ上にだけあり、
 * 再読み込みで消える。左に操作の一覧(新しい順)、右に「戻す範囲」を出し、選んだ操作とそれ以降を
 * 画面内の確認を経てまとめて戻す。
 */
export function HistoryScreen({ history }: HistoryScreenProps) {
  const { t } = useTranslation('history')
  const [operations, setOperations] = useState<HistoryOperation[] | null>(null)
  const [limit, setLimit] = useState(0)
  const [pickedId, setPickedId] = useState<number | null>(null)
  const [preview, setPreview] = useState<UndoPreview | null>(null)
  const [step, setStep] = useState<Step>('preview')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const [list, max] = await Promise.all([Promise.resolve(history.list()), Promise.resolve(history.limit())])
      setOperations(list)
      setLimit(max)
    } catch {
      setError(t('error.load'))
      setOperations((prev) => prev ?? [])
    }
  }, [history, t])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (pickedId === null) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await Promise.resolve(history.previewUndoTo(pickedId))
        if (!cancelled) setPreview(result)
      } catch {
        if (!cancelled) {
          setPickedId(null)
          void reload()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [history, pickedId, reload])

  const titleOf = (operation: HistoryOperation): string => {
    const direct = t(`operation.${operation.label}`, { defaultValue: '' })
    if (direct !== '') return direct
    const [key, method = ''] = operation.label.split('.')
    const entity = t(`entity.${key}`, { defaultValue: key })
    const verb = t(`verb.${method}`, { defaultValue: t('verb.other') })
    return `${entity}を${verb}`
  }

  const pick = (id: number) => {
    setPickedId(id)
    setStep('preview')
    setFlash('')
    setError('')
  }

  const undo = async () => {
    if (pickedId === null || busy) return
    setBusy(true)
    setError('')
    try {
      const count = await Promise.resolve(history.undoTo(pickedId))
      setPickedId(null)
      setStep('preview')
      setFlash(t('done', { count }))
    } catch {
      setPickedId(null)
      setStep('preview')
      setError(t('error.undo'))
    } finally {
      await reload()
      setBusy(false)
    }
  }

  const rangeIds = new Set(preview?.operations.map((o) => o.id) ?? [])
  const tableName = (table: string) => t(`table.${table}`, { defaultValue: table })

  return (
    <div className="history">
      <h1 className="history__title">{t('title')}</h1>
      <p className="history__lead">{t('lead')}</p>

      <div className="history__notice" role="note">
        <span>{t('notice.count', { count: operations?.length ?? 0, limit })}</span>
        <span>{t('notice.memory')}</span>
        <span>{t('notice.backup')}</span>
      </div>

      {flash !== '' && (
        <div className="history__flash" role="status">
          {flash}
        </div>
      )}
      {error !== '' && (
        <div className="history__error" role="alert">
          {error}
        </div>
      )}

      <div className="history__split">
        <section className="history__card" aria-labelledby="history-list-title">
          <h2 id="history-list-title" className="history__card-title">
            {t('list.heading')} <span>{t('list.order')}</span>
          </h2>
          {operations !== null && operations.length === 0 ? (
            <div className="history__empty">
              <div className="history__empty-title">{t('list.empty')}</div>
              {t('list.emptyHint')}
            </div>
          ) : (
            <ul className="history__list">
              {(operations ?? []).map((operation) => {
                const inRange = rangeIds.has(operation.id)
                const impact = summarizeImpact([operation])
                return (
                  <li key={operation.id}>
                    <button
                      type="button"
                      className={`history__row${inRange ? ' history__row--in-range' : ''}${pickedId === operation.id ? ' history__row--picked' : ''}`}
                      aria-pressed={pickedId === operation.id}
                      onClick={() => pick(operation.id)}
                    >
                      <span className="history__dot" aria-hidden="true" />
                      <span className="history__row-body">
                        <span className="history__row-title">{titleOf(operation)}</span>
                        {impact.journalEntries >= LARGE_IMPACT && (
                          <span className="history__tag history__tag--warn">
                            {t('list.impactEntries', { count: impact.journalEntries })}
                          </span>
                        )}
                      </span>
                      <span className="history__time">
                        {timeOf(operation)}
                        {inRange && <span className="history__tag history__tag--accent">{t('list.willUndo')}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <aside className="history__card history__panel" aria-labelledby="history-panel-title">
          <h2 id="history-panel-title" className="history__card-title">
            {t('panel.heading')}
          </h2>
          {preview === null || pickedId === null ? (
            <div className="history__empty">{t('panel.empty')}</div>
          ) : (
            <PanelBody
              preview={preview}
              step={step}
              busy={busy}
              titleOf={titleOf}
              tableName={tableName}
              onGo={() => setStep('confirm')}
              onCancel={() => setStep('preview')}
              onClear={() => setPickedId(null)}
              onConfirm={() => void undo()}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

interface PanelBodyProps {
  preview: UndoPreview
  step: Step
  busy: boolean
  titleOf: (operation: HistoryOperation) => string
  tableName: (table: string) => string
  onGo: () => void
  onCancel: () => void
  onClear: () => void
  onConfirm: () => void
}

function PanelBody({ preview, step, busy, titleOf, tableName, onGo, onCancel, onClear, onConfirm }: PanelBodyProps) {
  const { t } = useTranslation('history')
  const { operations, keptCount } = preview
  const selected = operations[operations.length - 1]
  const impact = summarizeImpact(operations)
  const count = operations.length

  return (
    <div className="history__panel-body">
      <div className="history__big">
        {t('panel.undoCount', { count })}
        <small>{t('panel.undoTo', { time: timeOf(selected), title: titleOf(selected) })}</small>
      </div>
      <div className="history__chips">
        {impact.journalEntries > 0 && (
          <span className="history__chip">{t('panel.impactEntries', { count: impact.journalEntries })}</span>
        )}
        {impact.journalEntries === 0 && impact.journalLines > 0 && (
          <span className="history__chip">{t('panel.impactLines', { count: impact.journalLines })}</span>
        )}
        {impact.masters > 0 && (
          <span className="history__chip">{t('panel.impactMasters', { count: impact.masters })}</span>
        )}
      </div>
      <div>
        <p className="history__steps-title">{t('panel.stepsHeading')}</p>
        <ol className="history__steps">
          {operations.map((operation, index) => (
            <li key={operation.id}>
              <span className="history__step-no">{index + 1}</span>
              <span>
                <span className="history__row-title">{titleOf(operation)}</span>{' '}
                <span className="history__time">{timeOf(operation)}</span>
                {describeUndoSteps(operation).map((s) => (
                  <span key={`${s.table}:${s.action}`} className="history__step-detail">
                    → {t(`action.${s.action}`, { table: tableName(s.table), count: s.count })}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {keptCount > 0 && <p className="history__kept">{t('panel.kept', { time: timeOf(selected), count: keptCount })}</p>}
      {step === 'preview' ? (
        <div className="history__buttons">
          <button type="button" className="history__btn history__btn--primary" onClick={onGo}>
            {t('panel.undoButton')}
          </button>
          <button type="button" className="history__btn" onClick={onClear}>
            {t('panel.clearButton')}
          </button>
        </div>
      ) : (
        <div className="history__confirm" role="alertdialog" aria-labelledby="history-confirm-text">
          <p id="history-confirm-text">{t('panel.confirmText', { count })}</p>
          <div className="history__buttons">
            <button type="button" className="history__btn history__btn--danger" disabled={busy} onClick={onConfirm}>
              {t('panel.confirmButton', { count })}
            </button>
            <button type="button" className="history__btn" disabled={busy} onClick={onCancel}>
              {t('panel.cancelButton')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
