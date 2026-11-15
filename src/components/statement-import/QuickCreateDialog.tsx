import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'

export interface QuickCreateGroupField {
  /** グループの選択欄の名称(「取引先グループ」など) */
  label: string
  categories: readonly TreeSelectCategory[]
}

export interface QuickCreateDialogProps {
  title: string
  /** 名前の入力欄のラベル */
  nameLabel: string
  /** 名前と、選んだグループ(未選択ならnull)を受け取って作る。groupFieldを渡さなければgroupIdは常にnull */
  onSubmit: (name: string, groupId: number | null) => Promise<void>
  onCancel: () => void
  /** 渡すと、名前の下にグループの選択欄を出す(選ばなければ未分類) */
  groupField?: QuickCreateGroupField
  /** グループの選択欄の下に足す欄(取込画面の取引先の追加のキーワードなど)。あるとダイアログを広げる */
  children?: ReactNode
  /** 追加を押したときの追加の検証。falseなら作らずに残る */
  validate?: () => boolean
}

/**
 * 取引先・プロジェクトを名前(と、必要ならグループなど)でその場に追加する小さなダイアログ
 * (計画Issue #151・#207)。科目の追加は登録フォーム(AccountCreateForm)を別に使う。
 * 入力欄・見出しは、ほかの項目と同じ見た目(import-control・import-field__label)にそろえる。
 */
export function QuickCreateDialog({ title, nameLabel, onSubmit, onCancel, groupField, children, validate }: QuickCreateDialogProps) {
  const { t } = useTranslation('statementImport')
  const nameId = useId()
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '') return
    if (validate && !validate()) return
    setSubmitting(true)
    setFailed(false)
    try {
      await onSubmit(name.trim(), groupId)
    } catch {
      setFailed(true)
      setSubmitting(false)
    }
  }

  return (
    <div className="import-dialog__backdrop">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`import-dialog${children ? ' import-dialog--wide' : ''}`}
        onSubmit={(e) => void submit(e)}
      >
        <h2 className="import-dialog__title">{title}</h2>
        <div className="import-field">
          <label className="import-field__label" htmlFor={nameId}>
            {nameLabel}
          </label>
          <input id={nameId} className="import-control" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {groupField && (
          <div className="import-field">
            <span className="import-field__label">{groupField.label}</span>
            <TreeSelect
              label={groupField.label}
              categories={groupField.categories}
              value={groupId === null ? '' : String(groupId)}
              emptyLabel={t('groupUnclassified')}
              placeholder={t('groupUnclassified')}
              onChange={(v) => setGroupId(v === '' ? null : Number(v))}
            />
          </div>
        )}
        {children}
        {failed && <p role="alert">{t('newCounterpartyError')}</p>}
        <div className="import-dialog__actions">
          <button type="button" className="import-btn" onClick={onCancel}>
            {t('cancelButton')}
          </button>
          <button type="submit" className="import-btn import-btn--primary" disabled={submitting || name.trim() === ''}>
            {t('addCounterpartyButton')}
          </button>
        </div>
      </form>
    </div>
  )
}
