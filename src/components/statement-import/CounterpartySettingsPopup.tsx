import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { KeywordList, type KeywordAccountOption, type KeywordListItem } from './KeywordList'

export interface CounterpartySettingsPopupProps {
  /** 取引先のキーワード(既定)か、資産・負債の科目のキーワード(計画Issue #219)か。リンク・タイトルの文言と、科目の選択欄の有無が変わる */
  kind?: 'counterparty' | 'account'
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  counterpartyName: string
  /** 取引先の登録済みキーワードを読み込み中はnull */
  items: readonly KeywordListItem[] | null
  /** キーワードの科目に選べる科目(取引先を持てる費用・収益の科目) */
  accountOptions?: readonly KeywordAccountOption[]
  /** この行の摘要(リンクの名前に使う) */
  rowDescription: string
  /** 「ほかの行にも適用」を押した結果の表示 */
  message: string
  /** 保存に失敗したときの表示(入力した内容は残す) */
  saveError: string
  onTextChange: (key: string, text: string) => void
  onCommit: (key: string) => void
  onDelete: (key: string) => void
  onAdd: () => void
  onAccountChange: (key: string, accountId: number | null) => void
  onApply: () => void
}

const POPUP_WIDTH = 520

/**
 * 取引先セルの下に置く「取引先の設定」のリンクと、押すと開くポップアップ(計画Issue #207)。
 * 取引先のキーワードの編集・削除・追加と、キーワードごとの科目の変更、ほかの行への適用ができる(計画Issue #219)。
 * 変更は操作した時点で保存される(「新規」のキーワードだけは、行を確定したときに登録される)。
 * ポップアップはTreeSelectと同じく画面に固定して描画し、表のoverflowで見切れないようにする。
 */
export function CounterpartySettingsPopup(props: CounterpartySettingsPopupProps) {
  const kind = props.kind ?? 'counterparty'
  const { isOpen, onToggle, onClose, counterpartyName, items, accountOptions, rowDescription, message, saveError } = props
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

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="import-link import-marker"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={kind === 'account' ? t('settingsLinkAccountLabel', { desc: rowDescription }) : t('settingsLinkLabel', { desc: rowDescription })}
        onClick={onToggle}
      >
        {kind === 'account' ? t('settingsLinkAccount') : t('settingsLink')} <span aria-hidden="true">▾</span>
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={popupRef}
            style={popupStyle}
            role="dialog"
            aria-label={kind === 'account' ? t('settingsTitleAccount', { name: counterpartyName }) : t('settingsTitle', { name: counterpartyName })}
            className="tree-select__popup import-settings"
            onKeyDown={handleKeyDown}
          >
            <p className="import-settings__title">
              {kind === 'account' ? t('settingsTitleAccount', { name: counterpartyName }) : t('settingsTitle', { name: counterpartyName })}
            </p>
            {kind === 'account' && <p className="import-note">{t('settingsNoteAccount', { name: counterpartyName })}</p>}
            {items === null ? (
              <p className="import-note" role="status">
                {t('settingsLoading')}
              </p>
            ) : (
              <>
                <KeywordList
                  items={items}
                  onTextChange={props.onTextChange}
                  onCommit={props.onCommit}
                  onDelete={props.onDelete}
                  onAdd={props.onAdd}
                  accountOptions={accountOptions}
                  label={kind === 'account' ? t('settingsPatternsLabelAccount') : undefined}
                  onAccountChange={props.onAccountChange}
                />

                {saveError !== '' && (
                  <span className="import-error" role="alert">
                    {saveError}
                  </span>
                )}
                {message !== '' && (
                  <span className="import-note" role="status">
                    {message}
                  </span>
                )}
                <div className="import-settings__actions">
                  <button type="button" className="import-btn import-btn--small" onClick={props.onApply}>
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
