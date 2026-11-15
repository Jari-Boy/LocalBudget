import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkerInitError } from '../../infrastructure/rpc/WorkerInitError'
import './SettingsScreen.css'

export interface StartupErrorScreenProps {
  error: WorkerInitError
  /** 起動時に読んだ元のDBをファイルとして書き出す(本番はdownloadDatabaseBackup) */
  onExport: (data: Uint8Array) => void
  /** アプリを最新にして再読み込みする(本番はupdateApp)。失敗したら例外を投げる */
  onUpdate: () => Promise<void>
  /** ページを再読み込みする(本番はwindow.location.reload) */
  onReload: () => void
}

/**
 * 起動エラー画面(計画Issue #42、承認済みモックアップ)。Worker起動の失敗を種類ごとに案内する。
 * 「フォルダに再接続」画面(StorageGate)と同じカードの見た目。
 * - schema-too-new: 新しいバージョンのアプリで保存されたデータ。開かず、アプリの更新とデータの書き出しを案内する
 * - migration-failed: 差分の適用に失敗。元のデータは変更されておらず、書き出せる
 * - other: 上記以外の起動失敗。エラー内容と再読み込みだけを出す
 */
export function StartupErrorScreen({ error, onExport, onUpdate, onReload }: StartupErrorScreenProps) {
  const { t } = useTranslation('settings')
  const [updateFailed, setUpdateFailed] = useState(false)
  const original = error.originalData

  async function handleUpdate() {
    setUpdateFailed(false)
    try {
      await onUpdate()
    } catch {
      setUpdateFailed(true)
    }
  }

  const primary = 'settings__button settings__button--primary settings__button--large'
  const secondary = 'settings__button settings__button--large'

  if (error.reason === 'schema-too-new') {
    return (
      <div className="settings__reconnect">
        <section className="settings__card settings__reconnect-card">
          <h1 className="settings__reconnect-title">{t('startupError.tooNew.title')}</h1>
          <p className="settings__reconnect-message settings__pre-line">{t('startupError.tooNew.message')}</p>
          {updateFailed && (
            <div role="alert" className="settings__error">
              {t('startupError.tooNew.updateFailed')}
            </div>
          )}
          <div className="settings__reconnect-actions">
            <button type="button" className={primary} onClick={() => void handleUpdate()}>
              {t('startupError.tooNew.update')}
            </button>
            {original !== null && (
              <button type="button" className={secondary} onClick={() => onExport(original)}>
                {t('startupError.tooNew.export')}
              </button>
            )}
          </div>
          {original !== null && <p className="settings__hint">{t('startupError.tooNew.hint')}</p>}
        </section>
      </div>
    )
  }

  const failed = error.reason === 'migration-failed'
  return (
    <div className="settings__reconnect">
      <section className="settings__card settings__reconnect-card">
        <h1 className="settings__reconnect-title">{t(failed ? 'startupError.failed.title' : 'startupError.other.title')}</h1>
        <p className="settings__reconnect-message settings__pre-line">
          {t(failed ? 'startupError.failed.message' : 'startupError.other.message')}
        </p>
        <div role="alert" className="settings__error settings__break-all">
          {t('startupError.errorDetail', { message: error.message })}
        </div>
        {failed && original !== null && <p className="settings__hint">{t('startupError.failed.backupHint')}</p>}
        <div className="settings__reconnect-actions">
          {failed && original !== null && (
            <button type="button" className={primary} onClick={() => onExport(original)}>
              {t('startupError.failed.export')}
            </button>
          )}
          <button type="button" className={failed && original !== null ? secondary : primary} onClick={onReload}>
            {t('startupError.reload')}
          </button>
        </div>
        {failed && <p className="settings__hint">{t('startupError.failed.contact')}</p>}
      </section>
    </div>
  )
}
