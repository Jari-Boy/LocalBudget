import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import {
  addDraftPattern,
  countRowsContaining,
  removeDraftPattern,
  setDraftDefaultAccount,
  updateDraftPatternText,
  validateDraftPatterns,
  type CounterpartyDraft,
  type DraftPatternError,
} from './counterpartyDraftModel'

export interface CounterpartySettingsPopupProps {
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  counterpartyName: string
  /** 取引先の登録済みパターンを読み込み中はnull */
  draft: CounterpartyDraft | null
  /** 「この明細で含む行の数」の対象にする、未確定の行の摘要 */
  descriptions: readonly string[]
  /** この行の摘要(新規パターンは、この摘要に含まれる文字列だけ入力できる) */
  rowDescription: string
  /** 「この行の科目を入れる」で取り込む、この行の相手科目(取引先を持てない科目ならnull) */
  rowAccount: { id: number; name: string } | null
  /** 相手科目の初期値に選べる科目(取引先を持てる費用・収益の科目) */
  accountCategories: readonly TreeSelectCategory[]
  /** 「ほかの行にも適用」を押した結果の表示 */
  message: string
  onChange: (draft: CounterpartyDraft) => void
  onApply: () => void
}

const POPUP_WIDTH = 420

/**
 * 取引先セルの下に置く「取引先の設定」のリンクと、押すと開くポップアップ(計画Issue #207)。
 * 取引先のパターン(登録済み・新規)の編集・削除・追加と、相手科目の初期値の変更、ほかの行への適用ができる。
 * 変更は取引先ごとの下書きに入り、DBへは確定時にだけ保存する。ポップアップはTreeSelectと同じく画面に固定して描画し、
 * 表のoverflowで見切れないようにする。
 */
export function CounterpartySettingsPopup(props: CounterpartySettingsPopupProps) {
  const { isOpen, onToggle, onClose, counterpartyName, draft, descriptions, rowDescription, rowAccount, accountCategories, message, onChange, onApply } = props
  const { t } = useTranslation('statementImport')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({ position: 'fixed' })

  useLayoutEffect(() => {
    if (!isOpen) return
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      const width = Math.min(POPUP_WIDTH, window.innerWidth * 0.92)
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8))
      const below = window.innerHeight - trigger.bottom - 12
      const above = trigger.top - 12
      const openUp = below < 420 && above > below
      setPopupStyle(
        openUp
          ? { position: 'fixed', left, width, bottom: window.innerHeight - trigger.top + 4, maxHeight: above }
          : { position: 'fixed', left, width, top: trigger.bottom + 4, maxHeight: Math.max(below, 240) },
      )
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element
      // 中の科目選択(TreeSelect)のポップアップは別の場所に描画されるので、外側のクリックとは見なさない
      if (target.closest('.tree-select__popup') || popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen, onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
    triggerRef.current?.focus()
  }

  const errors = draft ? validateDraftPatterns(draft) : new Map<string, DraftPatternError>()
  const errorText = (error: DraftPatternError) =>
    error === 'empty' ? t('patternErrorEmpty') : error === 'duplicate' ? t('patternErrorDuplicate') : t('patternErrorNotInDescription')

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="import-link import-marker"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t('settingsLinkLabel', { desc: rowDescription })}
        onClick={onToggle}
      >
        {t('settingsLink')} <span aria-hidden="true">▾</span>
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={popupRef}
            style={popupStyle}
            role="dialog"
            aria-label={t('settingsTitle', { name: counterpartyName })}
            className="tree-select__popup import-settings"
            onKeyDown={handleKeyDown}
          >
            <p className="import-settings__title">{t('settingsTitle', { name: counterpartyName })}</p>
            <p className="import-note">{t('settingsNote')}</p>
            {draft === null ? (
              <p className="import-note" role="status">
                {t('settingsLoading')}
              </p>
            ) : (
              <>
                <div className="import-field">
                  <span className="import-field__label">{t('settingsPatternsLabel')}</span>
                  {draft.patterns.map((pattern, index) => {
                    const error = errors.get(pattern.key)
                    const isNew = pattern.patternId === null
                    return (
                      <div key={pattern.key} className="import-settings__pattern">
                        <div className="import-settings__row">
                          <span className={`import-tag ${isNew ? 'import-tag--new' : 'import-tag--registered'}`}>
                            {isNew ? t('tagNew') : t('tagRegistered')}
                          </span>
                          <input
                            className="import-control import-control--small import-settings__input"
                            aria-label={t('patternInput', { index: index + 1 })}
                            aria-invalid={error !== undefined}
                            value={pattern.text}
                            onChange={(e) => onChange(updateDraftPatternText(draft, pattern.key, e.target.value))}
                          />
                          <span className="import-note import-nowrap" title={t('patternRowsTitle')}>{t('patternRows', { count: countRowsContaining(pattern.text, descriptions) })}</span>
                          <button
                            type="button"
                            className="import-link"
                            aria-label={t('patternDeleteLabel', { index: index + 1 })}
                            onClick={() => onChange(removeDraftPattern(draft, pattern.key))}
                          >
                            {t('patternDelete')}
                          </button>
                        </div>
                        {error !== undefined && <span className="import-error import-settings__error">{errorText(error)}</span>}
                      </div>
                    )
                  })}
                  <div>
                    <button
                      type="button"
                      className="import-btn import-btn--small"
                      onClick={() => onChange(addDraftPattern(draft, { text: '', sourceDescription: rowDescription }))}
                    >
                      {t('patternAdd')}
                    </button>
                  </div>
                </div>

                <div className="import-field import-settings__section">
                  <span className="import-field__label">{t('defaultAccountLabel')}</span>
                  <div className="import-settings__row">
                    <TreeSelect
                      label={t('defaultAccountLabel')}
                      categories={accountCategories}
                      value={draft.defaultAccountId === null ? '' : String(draft.defaultAccountId)}
                      emptyLabel={t('defaultAccountNone')}
                      placeholder={t('defaultAccountNone')}
                      onChange={(v) => onChange(setDraftDefaultAccount(draft, v === '' ? null : Number(v)))}
                    />
                    {rowAccount !== null && draft.defaultAccountId !== rowAccount.id && (
                      <button
                        type="button"
                        className="import-link import-nowrap"
                        aria-label={t('useRowAccountLabel', { account: rowAccount.name })}
                        onClick={() => onChange(setDraftDefaultAccount(draft, rowAccount.id))}
                      >
                        {t('useRowAccount')}
                      </button>
                    )}
                  </div>
                </div>

                {message !== '' && (
                  <span className="import-note" role="status">
                    {message}
                  </span>
                )}
                <div className="import-settings__actions">
                  <button type="button" className="import-btn import-btn--small" onClick={onApply}>
                    {t('applyToOtherRows')}
                  </button>
                  <button
                    type="button"
                    className="import-btn import-btn--small import-btn--primary"
                    onClick={() => {
                      onClose()
                      triggerRef.current?.focus()
                    }}
                  >
                    {t('settingsClose')}
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
