import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { KeywordList, type KeywordListItem } from './KeywordList'

export interface CounterpartySettingsPopupProps {
  /** 取引先のキーワード(既定)か、科目のキーワード(取引先なしで、その科目を持つキーワード。計画Issue #219・#259)か。見出しの文言と、科目の選択欄の有無が変わる */
  kind?: 'counterparty' | 'account'
  isOpen: boolean
  /** 取引先・科目が未選択のときはtrue(アイコンを押せなくする) */
  disabled?: boolean
  /** この行に一致したキーワードがある側のアイコンを強調する(計画Issue #259) */
  highlighted?: boolean
  /** アイコンのツールチップ(一致したキーワードがあれば、それを出す) */
  tooltip?: string
  onToggle: () => void
  /** 閉じる操作(閉じるボタン・Esc・外側クリック)。入力中の内容の保存は呼び出し側が行う */
  onClose: () => void
  counterpartyName: string
  /** 取引先の登録済みキーワードを読み込み中はnull */
  items: readonly KeywordListItem[] | null
  /** 渡すと、キーワードの科目を、科目グループごとにまとめて選ぶ部品(TreeSelect)で出す。渡さなければ科目の欄は出さない */
  accountCategories?: readonly TreeSelectCategory[]
  /** この行の摘要(リンクの名前に使う) */
  rowDescription: string
  /** 「N行に適用」を押した結果の表示 */
  message: string
  /** 保存に失敗したときの表示(入力した内容は残す) */
  saveError: string
  onTextChange: (key: string, text: string) => void
  onCommit: (key: string) => void
  onDelete: (key: string) => void
  onAdd: () => void
  onAccountChange: (key: string, accountId: number | null) => void
  /** キーワードの行ごとの「N行に適用」(計画Issue #259) */
  renderApply: (item: KeywordListItem) => ReactNode
}

const POPUP_WIDTH = 720

/**
 * 相手科目・取引先の選択欄の右に置くキーワードのアイコンボタンと、押すと開くポップアップ(計画Issue #207・#259)。
 * キーワードの編集・削除・追加と、キーワードごとの科目の変更、キーワードごとのほかの行への適用ができる(計画Issue #219)。
 * 保存ボタンは無く、入力を終えたとき(フォーカスを外す・Enter)と閉じる操作で保存される。
 * ポップアップはTreeSelectと同じく画面に固定して描画し、表のoverflowで見切れないようにする。
 */
export function CounterpartySettingsPopup(props: CounterpartySettingsPopupProps) {
  const kind = props.kind ?? 'counterparty'
  const { isOpen, onToggle, onClose, counterpartyName, items, accountCategories, rowDescription, message, saveError } = props
  const disabled = props.disabled === true
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

  const title = kind === 'account' ? t('settingsTitleAccount', { name: counterpartyName }) : t('settingsTitle', { name: counterpartyName })
  const iconLabel = kind === 'account' ? t('keywordIconAccountLabel', { desc: rowDescription }) : t('keywordIconCounterpartyLabel', { desc: rowDescription })

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`import-icon-btn${props.highlighted === true ? ' import-icon-btn--matched' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={iconLabel}
        title={disabled ? t('keywordIconDisabledTitle', { kind: kind === 'account' ? t('keywordKindAccount') : t('keywordKindCounterparty') }) : (props.tooltip ?? iconLabel)}
        disabled={disabled}
        onClick={onToggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="import-icon">
          <path d="M2.5 8.5V3.5h5l6 6-5 5-6-6z" />
          <circle cx="5.2" cy="6.2" r="0.9" />
        </svg>
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={popupRef}
            style={popupStyle}
            role="dialog"
            aria-label={title}
            className="tree-select__popup import-settings"
            onKeyDown={handleKeyDown}
          >
            <p className="import-settings__title">{title}</p>
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
                  renderApply={props.renderApply}
                  renderAccount={
                    accountCategories === undefined
                      ? undefined
                      : (item, index) => (
                          <TreeSelect
                            label={t('patternAccountLabel', { index: index + 1 })}
                            categories={accountCategories}
                            favoriteKind="account"
                            value={item.accountId == null ? '' : String(item.accountId)}
                            emptyLabel={t('defaultAccountNone')}
                            placeholder={t('defaultAccountNone')}
                            disabled={item.accountLocked === true}
                            onChange={(v) => props.onAccountChange(item.key, v === '' ? null : Number(v))}
                          />
                        )
                  }
                  label={kind === 'account' ? t('settingsPatternsLabelAccount') : undefined}
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
