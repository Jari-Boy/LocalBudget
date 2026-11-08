import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

export interface QuickCreateDialogProps {
  title: string
  /** 名前の入力欄のラベル */
  nameLabel: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/**
 * 明細取込画面で、取引先・プロジェクトを名前だけでその場に追加する小さなダイアログ
 * (計画Issue #151)。科目の追加は登録フォーム(AccountCreateForm)を別に使う。
 */
export function QuickCreateDialog({ title, nameLabel, onSubmit, onCancel }: QuickCreateDialogProps) {
  const { t } = useTranslation('statementImport')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '') return
    setSubmitting(true)
    setFailed(false)
    try {
      await onSubmit(name.trim())
    } catch {
      setFailed(true)
      setSubmitting(false)
    }
  }

  return (
    <div className="import-dialog__backdrop">
      <form role="dialog" aria-modal="true" aria-label={title} className="import-dialog" onSubmit={(e) => void submit(e)}>
        <h2 className="import-dialog__title">{title}</h2>
        <label className="import-dialog__field">
          {nameLabel}
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
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
