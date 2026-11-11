import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StorageStatus } from '../../infrastructure/rpc/createStorageApi'
import '../common/unsaved-changes/UnsavedChangesDialog.css'
import { backupFileName } from './backupFileName'
import type { BackupApi } from './SettingsScreen'
import type { StorageApi } from './StorageSection'
import './SettingsScreen.css'

/** 保存が止まったかを取り直す間隔(ミリ秒)。止まるのは保存の直前なので、編集から数秒で気づけば足りる。 */
const POLL_INTERVAL_MS = 3000

export interface ExternalChangeBannerProps {
  storage: Pick<StorageApi, 'getStatus'>
  backup: Pick<BackupApi, 'export'>
  /** DBのバイト列をファイルとしてダウンロードさせる(本番はdownloadDatabaseBackup) */
  download: (data: Uint8Array, fileName: string) => void
  /** ページを再読み込みし、Workerにフォルダの最新のファイルを読み直させる(本番はwindow.location.reload) */
  reload: () => void
  now?: () => Date
  pollIntervalMs?: number
}

/**
 * 保存先のフォルダのファイルが別の端末で更新されたため、このタブが保存を止めているときの警告
 * (計画Issue #175、承認済みモックアップ2・3)。保存が止まっている間の入力は保存されないため、
 * 画面の上部に常駐させ、閉じられないようにする(知らないまま入力を続けてしまわないように)。
 * 退避の導線として今のデータの書き出し、復帰の導線としてフォルダのファイルの開き直し(再読み込み。
 * 止まっている間の入力が失われるため確認ダイアログを挟む)を置く。自動マージはしない。
 * 保存が止まったかどうかはWorker側の状態なので、一定間隔でgetStatus()を取り直して検知する。
 */
export function ExternalChangeBanner({
  storage,
  backup,
  download,
  reload,
  now = () => new Date(),
  pollIntervalMs = POLL_INTERVAL_MS,
}: ExternalChangeBannerProps) {
  const { t } = useTranslation('settings')
  const [externalChange, setExternalChange] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void storage
        .getStatus()
        .then((status: StorageStatus) => {
          if (!cancelled) setExternalChange(status.externalChange)
        })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, pollIntervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [storage, pollIntervalMs])

  async function handleExport() {
    setExportFailed(false)
    try {
      download(await backup.export(), backupFileName(now()))
    } catch {
      setExportFailed(true)
    }
  }

  if (!externalChange) return null

  return (
    <>
      <div role="alert" className="settings__external-change">
        <div className="settings__external-change-text">
          <b>{t('externalChange.title')}</b>
          <br />
          {t('externalChange.message')}
          {exportFailed && <div className="settings__error">{t('externalChange.exportFailed')}</div>}
        </div>
        <div className="settings__external-change-actions">
          <button type="button" className="settings__button" onClick={() => void handleExport()}>
            {t('externalChange.export')}
          </button>
          <button type="button" className="settings__button settings__button--danger" onClick={() => setConfirming(true)}>
            {t('externalChange.reopen')}
          </button>
        </div>
      </div>

      {confirming && (
        <div className="unsaved-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby="external-change-title" className="unsaved-dialog">
            <h2 id="external-change-title" className="unsaved-dialog__title">
              {t('externalChange.dialog.title')}
            </h2>
            <p className="unsaved-dialog__message">{t('externalChange.dialog.message')}</p>
            <div className="settings__export-first">
              <span className="settings__hint">{t('externalChange.dialog.exportFirst')}</span>
              <button type="button" className="settings__button settings__button--small" onClick={() => void handleExport()}>
                {t('externalChange.export')}
              </button>
            </div>
            <div className="unsaved-dialog__actions">
              <button type="button" className="unsaved-dialog__button" onClick={() => setConfirming(false)}>
                {t('externalChange.dialog.cancel')}
              </button>
              <button type="button" className="unsaved-dialog__button settings__button--danger" onClick={reload}>
                {t('externalChange.dialog.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
