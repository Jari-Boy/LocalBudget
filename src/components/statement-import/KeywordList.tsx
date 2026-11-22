import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeywordError } from './counterpartyKeywordModel'

export interface KeywordListItem {
  key: string
  /** 登録済み(DBに保存済み)か、新規(まだ保存していない)か。タグの表示だけが違う */
  kind: 'registered' | 'new'
  text: string
  /** この明細で、このキーワードを含む行の数 */
  count: number
  error: KeywordError | null
  /** このキーワードに紐づく科目(費用・収益。なければnull)。科目の選択欄を出すときだけ使う(計画Issue #219) */
  accountId?: number | null
  /** 科目を変えられないとき */
  accountLocked?: boolean
  /** この行(ポップアップを開いた明細の行)の摘要に一致するキーワードか。強調して「この行に一致」を出す(計画Issue #259) */
  matched?: boolean
}

export interface KeywordListProps {
  items: readonly KeywordListItem[]
  onTextChange: (key: string, text: string) => void
  /** 入力を終えたとき(フォーカスを外す・Enter)。保存するかどうかは呼び出し側が決める */
  onCommit: (key: string) => void
  onDelete: (key: string) => void
  onAdd: () => void
  /** 科目の欄を自前の部品で描く(取引先の追加ダイアログ。科目の新規登録つきの選択部品を使うため)。渡さなければ科目の欄は出さない */
  renderAccount?: (item: KeywordListItem, index: number) => ReactNode
  /** キーワードの行ごとの操作欄(「N行に適用」。計画Issue #259)。渡さなければ出さない */
  renderApply?: (item: KeywordListItem, index: number) => ReactNode
  /** 一覧の見出し(既定は「取引先のキーワード」)。科目のキーワードでは「キーワード」 */
  label?: string
}

/**
 * 取引先のキーワード(取引先のパターン)の一覧(計画Issue #207)。明細取込の「取引先の設定」と
 * 取引先の追加ダイアログで同じものを使う。各行は「登録済み」「新規」のタグ・入力欄・含む行の数・削除、
 * 末尾に「キーワードを追加」。
 */
export function KeywordList({ items, onTextChange, onCommit, onDelete, onAdd, renderAccount, renderApply, label }: KeywordListProps) {
  const { t } = useTranslation('statementImport')
  const hasMatched = items.some((item) => item.matched === true)
  const errorText = (error: KeywordError) => (error === 'empty' ? t('patternErrorEmpty') : t('patternErrorDuplicate'))

  return (
    <div className="import-field">
      <span className="import-field__label">{label ?? t('settingsPatternsLabel')}</span>
      {items.map((item, index) => (
        <div key={item.key} className={`import-settings__pattern${item.matched === true ? ' import-settings__pattern--matched' : ''}`}>
          <div className="import-settings__row">
            <span className={`import-tag ${item.kind === 'new' ? 'import-tag--new' : 'import-tag--registered'}`}>
              {item.kind === 'new' ? t('tagNew') : t('tagRegistered')}
            </span>
            <input
              className="import-control import-control--small import-settings__input"
              aria-label={t('patternInput', { index: index + 1 })}
              aria-invalid={item.error !== null}
              value={item.text}
              onChange={(e) => onTextChange(item.key, e.target.value)}
              onBlur={() => onCommit(item.key)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                // ダイアログのフォームの送信にならないようにし、入力を終えたこととして扱う
                e.preventDefault()
                onCommit(item.key)
              }}
            />
            {renderAccount?.(item, index)}
            {/* 一致の有無で入力欄の幅が変わらないよう、一致する行がひとつでもあれば、全行に同じ幅の枠を確保する */}
            {hasMatched && (
              <span className="import-settings__matched import-nowrap">{item.matched === true ? t('patternMatchedRow') : ''}</span>
            )}
            <span className="import-note import-nowrap" title={t('patternRowsTitle')}>
              {t('patternRows', { count: item.count })}
            </span>
            {renderApply?.(item, index)}
            <button
              type="button"
              className="import-icon-btn import-icon-btn--danger"
              aria-label={t('patternDeleteLabel', { index: index + 1 })}
              title={t('patternDelete')}
              onClick={() => onDelete(item.key)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="import-icon">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8M7 7v3.5M9 7v3.5" />
              </svg>
            </button>
          </div>
          {item.error !== null && <span className="import-error import-settings__error">{errorText(item.error)}</span>}
          {/* 現在の明細の摘要にマッチしない新規キーワードは、登録できるが、タイプミスなどに気づけるよう注意を出す(計画Issue #236) */}
          {item.error === null && item.kind === 'new' && item.text.trim() !== '' && item.count === 0 && (
            <span className="import-warning import-settings__error">{t('patternWarnNoMatch')}</span>
          )}
        </div>
      ))}
      <div className="import-settings__add">
        <button type="button" className="import-btn import-btn--small" onClick={onAdd}>
          {t('patternAdd')}
        </button>
      </div>
    </div>
  )
}
