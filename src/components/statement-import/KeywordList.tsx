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
  /** 科目を変えられないとき(摘要の提案など。その行の相手科目が使われる) */
  accountLocked?: boolean
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
  /** 一覧の見出し(既定は「取引先のキーワード」)。科目のキーワードでは「キーワード」 */
  label?: string
}

/**
 * 取引先のキーワード(取引先のパターン)の一覧(計画Issue #207)。明細取込の「取引先の設定」と
 * 取引先の追加ダイアログで同じものを使う。各行は「登録済み」「新規」のタグ・入力欄・含む行の数・削除、
 * 末尾に「キーワードを追加」。
 */
export function KeywordList({ items, onTextChange, onCommit, onDelete, onAdd, renderAccount, label }: KeywordListProps) {
  const { t } = useTranslation('statementImport')
  const errorText = (error: KeywordError) =>
    error === 'empty' ? t('patternErrorEmpty') : error === 'duplicate' ? t('patternErrorDuplicate') : t('patternErrorNotInDescription')

  return (
    <div className="import-field">
      <span className="import-field__label">{label ?? t('settingsPatternsLabel')}</span>
      {items.map((item, index) => (
        <div key={item.key} className="import-settings__pattern">
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
            <span className="import-note import-nowrap" title={t('patternRowsTitle')}>
              {t('patternRows', { count: item.count })}
            </span>
            <button
              type="button"
              className="import-link"
              aria-label={t('patternDeleteLabel', { index: index + 1 })}
              onClick={() => onDelete(item.key)}
            >
              {t('patternDelete')}
            </button>
          </div>
          {item.error !== null && <span className="import-error import-settings__error">{errorText(item.error)}</span>}
        </div>
      ))}
      <div>
        <button type="button" className="import-btn import-btn--small" onClick={onAdd}>
          {t('patternAdd')}
        </button>
      </div>
    </div>
  )
}
