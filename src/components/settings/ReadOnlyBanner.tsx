import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StorageApi } from './StorageSection'
import './SettingsScreen.css'

export interface ReadOnlyBannerProps {
  storage: Pick<StorageApi, 'getStatus'>
  /** ページを再読み込みして書き込みの権利を取り直す(本番はwindow.location.reload) */
  reload: () => void
}

/**
 * 別のタブが保存先への書き込みの権利を持っていて、このタブの変更が保存されないときの警告
 * (計画Issue #174、承認済みモックアップ7)。2つのタブが同時に書くと、後から保存したタブが先の内容を
 * 古いDBで上書きしてしまうため、書き込めるのは一つのタブだけにしている(docs/architecture.md 4.2節)。
 * 書き込めるタブでは何も出さない。
 */
export function ReadOnlyBanner({ storage, reload }: ReadOnlyBannerProps) {
  const { t } = useTranslation('settings')
  const [writable, setWritable] = useState(true)

  useEffect(() => {
    let cancelled = false
    void storage
      .getStatus()
      .then((status) => {
        if (!cancelled) setWritable(status.writable)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [storage])

  if (writable) return null

  return (
    <div role="alert" className="settings__read-only">
      <span>
        <b>{t('readOnlyBanner.title')}</b>
        {t('readOnlyBanner.message')}
      </span>
      <button type="button" className="settings__button" onClick={reload}>
        {t('readOnlyBanner.recheck')}
      </button>
    </div>
  )
}
