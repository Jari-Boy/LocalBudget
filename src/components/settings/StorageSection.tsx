import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InvalidBackupFileError } from '../../infrastructure/backup/InvalidBackupFileError'
import type { StorageRpcApi, StorageStatus } from '../../infrastructure/rpc/createStorageApi'
import type { FolderPicker } from '../../infrastructure/storage/browserFolderPicker'
import { DATABASE_FILE_NAME, type FolderDatabaseInfo } from '../../infrastructure/storage/describeFolderDatabase'
import '../common/unsaved-changes/UnsavedChangesDialog.css'
import { formatDateTime, formatFileSize } from './fileInfoFormat'
import './SettingsScreen.css'

/** 設定画面が使うWorker側の保存先API(RepositoryRegistry.storage、計画Issue #174)。RPC越しなのでPromiseで受ける。 */
export interface StorageApi {
  getStatus(): Promise<StorageStatus>
  moveToFolder: StorageRpcApi['moveToFolder']
  moveToIndexedDb: StorageRpcApi['moveToIndexedDb']
}

export type { FolderPicker }

export interface StorageSectionProps {
  storage: StorageApi
  folderPicker: FolderPicker
  /** 今のデータを書き出す(ブラウザ保存に戻す前の退避。設定画面のバックアップ書き出しと同じ) */
  exportCurrent: () => void
  /** ページを再読み込みし、Workerに新しい保存先から読み直させる */
  reload: () => void
}

type Dialog =
  | { kind: 'none' }
  | { kind: 'existing'; folder: FileSystemDirectoryHandle; info: FolderDatabaseInfo; choice: 'open' | 'copy' }
  | { kind: 'revert'; choice: 'copy' | 'keep' }
  | { kind: 'working' }
  | { kind: 'invalid' }
  | { kind: 'failed' }

/**
 * 設定画面の「データの保存先」欄(計画Issue #174、承認済みモックアップ)。現在の保存先を表示し、
 * ブラウザ内/フォルダの切り替えを行う。フォルダの選択はメインスレッドで行い、データの移動は
 * Worker側のAPIに任せる。成功したらページを再読み込みして、新しい保存先から起動し直す。
 * 切り替えは、フォルダが空なら今のデータをそのまま移し、既存のDBファイルがあるときだけ
 * 「開く/上書き」を選ばせる。「開く」はWorker側のスキーマ検証を通らなければ、何も変えずに理由を示す。
 */
export function StorageSection({ storage, folderPicker, exportCurrent, reload }: StorageSectionProps) {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })

  useEffect(() => {
    let cancelled = false
    void storage
      .getStatus()
      .then((loaded) => {
        if (!cancelled) setStatus(loaded)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [storage])

  const close = () => setDialog({ kind: 'none' })

  /** 切り替えを実行し、成功なら再読み込み、失敗なら理由のダイアログを出す。 */
  async function run(operation: () => Promise<void>) {
    setDialog({ kind: 'working' })
    try {
      await operation()
    } catch (error) {
      setDialog({ kind: error instanceof InvalidBackupFileError ? 'invalid' : 'failed' })
      return
    }
    reload()
  }

  async function handlePick() {
    let folder: FileSystemDirectoryHandle | null
    let info: FolderDatabaseInfo | null
    try {
      folder = await folderPicker.pick()
      if (folder === null) return
      info = await folderPicker.describe(folder)
    } catch {
      setDialog({ kind: 'failed' })
      return
    }
    if (info === null) {
      void run(() => storage.moveToFolder(folder, 'copy'))
    } else {
      setDialog({ kind: 'existing', folder, info, choice: 'open' })
    }
  }

  const writable = status?.writable ?? true
  const canPick = folderPicker.isSupported && writable
  const inFolder = status?.kind === 'folder'

  return (
    <section className="settings__card" aria-labelledby="settings-storage-heading">
      <h2 id="settings-storage-heading" className="settings__card-title">
        {t('storage.heading')}
      </h2>

      <div className="settings__storage">
        <span className="settings__muted">{t('storage.label')}</span>
        <span className="settings__strong">{inFolder ? t('storage.folder') : t('storage.browser')}</span>
      </div>
      {inFolder && (
        <>
          <div className="settings__storage">
            <span className="settings__muted">{t('storage.folderName')}</span>
            <span className="settings__strong">{status.folderName}</span>
            <span className="settings__badge">{t('storage.connected')}</span>
          </div>
          <div className="settings__storage">
            <span className="settings__muted">{t('storage.fileName')}</span>
            <span>{DATABASE_FILE_NAME}</span>
          </div>
        </>
      )}
      <p className="settings__hint">{inFolder ? t('storage.folderNote') : t('storage.browserNote')}</p>
      {/* ブラウザはプライバシー保護のため、選んだフォルダの場所(フルパス)をアプリに渡さない */}
      {inFolder && <p className="settings__hint">{t('storage.folderNameNote')}</p>}

      {/* 同期フォルダは複数のPCから見えるため、上書き事故を防ぐ前提を利用者に伝える(計画Issue #175) */}
      {inFolder && (
        <div className="settings__sync-note">
          <div className="settings__sync-note-title">{t('storage.syncNote.title')}</div>
          <ul>
            <li>{t('storage.syncNote.single')}</li>
            <li>{t('storage.syncNote.mirror')}</li>
            <li>{t('storage.syncNote.stale')}</li>
          </ul>
        </div>
      )}

      {!writable && (
        <div role="status" className="settings__warning-box">
          {t('storage.readOnly')}
        </div>
      )}

      <div className="settings__row">
        <div className="settings__row-text">
          <div className="settings__strong">{inFolder ? t('storage.change.title') : t('storage.toFolder.title')}</div>
          <div className="settings__hint">
            {inFolder ? t('storage.change.description') : t('storage.toFolder.description')}
          </div>
          {!inFolder && <div className="settings__hint">{t('storage.toFolder.note')}</div>}
          {!folderPicker.isSupported && (
            <>
              <div className="settings__hint settings__warning">{t('storage.unsupported.reason')}</div>
              <div className="settings__hint">{t('storage.unsupported.guide')}</div>
            </>
          )}
        </div>
        <button
          type="button"
          className={`settings__button${inFolder ? '' : ' settings__button--primary'}`}
          disabled={!canPick}
          onClick={() => void handlePick()}
        >
          {t('storage.pickButton')}
        </button>
      </div>

      {inFolder && (
        <div className="settings__row">
          <div className="settings__row-text">
            <div className="settings__strong">{t('storage.revert.title')}</div>
            <div className="settings__hint">{t('storage.revert.description')}</div>
          </div>
          <button
            type="button"
            className="settings__button"
            disabled={!writable}
            onClick={() => setDialog({ kind: 'revert', choice: 'copy' })}
          >
            {t('storage.revert.button')}
          </button>
        </div>
      )}

      {dialog.kind === 'existing' && (
        <ExistingFileDialog
          folderName={dialog.folder.name}
          info={dialog.info}
          choice={dialog.choice}
          onChoice={(choice) => setDialog({ ...dialog, choice })}
          onCancel={close}
          onSubmit={() => void run(() => storage.moveToFolder(dialog.folder, dialog.choice))}
        />
      )}

      {dialog.kind === 'revert' && (
        <RevertDialog
          choice={dialog.choice}
          onChoice={(choice) => setDialog({ kind: 'revert', choice })}
          onExportFirst={exportCurrent}
          onCancel={close}
          onSubmit={() => void run(() => storage.moveToIndexedDb(dialog.choice))}
        />
      )}

      {dialog.kind === 'working' && (
        <div className="unsaved-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-busy aria-labelledby="storage-working-title" className="unsaved-dialog">
            <h2 id="storage-working-title" className="unsaved-dialog__title">
              {t('storage.working.title')}
            </h2>
            <div className="settings__progress" role="progressbar" aria-label={t('storage.working.progress')}>
              <div className="settings__progress-bar" />
            </div>
            <p className="unsaved-dialog__message">{t('storage.working.message')}</p>
            <p className="settings__hint">{t('importing.keepOpen')}</p>
          </div>
        </div>
      )}

      {(dialog.kind === 'invalid' || dialog.kind === 'failed') && (
        <div className="unsaved-dialog__backdrop">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="storage-error-title"
            className="unsaved-dialog"
          >
            <h2 id="storage-error-title" className="unsaved-dialog__title settings__danger-text">
              {dialog.kind === 'invalid' ? t('storage.invalid.title') : t('failed.title')}
            </h2>
            <p className="unsaved-dialog__message">
              {dialog.kind === 'invalid' ? t('storage.invalid.message') : t('failed.message')}
            </p>
            {dialog.kind === 'invalid' && (
              <p className="unsaved-dialog__message">
                <b>{t('invalid.unchanged')}</b>
              </p>
            )}
            <div className="unsaved-dialog__actions">
              <button type="button" className="unsaved-dialog__button unsaved-dialog__button--primary" onClick={close}>
                {t('failed.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

interface ExistingFileDialogProps {
  folderName: string
  info: FolderDatabaseInfo
  choice: 'open' | 'copy'
  onChoice: (choice: 'open' | 'copy') => void
  onCancel: () => void
  onSubmit: () => void
}

/** 選んだフォルダに既存のDBファイルがあるときの「開く/上書き」の選択(計画Issue #174)。 */
function ExistingFileDialog({ folderName, info, choice, onChoice, onCancel, onSubmit }: ExistingFileDialogProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="unsaved-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="storage-existing-title" className="unsaved-dialog">
        <h2 id="storage-existing-title" className="unsaved-dialog__title">
          {t('storage.existing.title')}
        </h2>
        <dl className="settings__file-info">
          <dt>{t('storage.existing.folder')}</dt>
          <dd className="settings__strong">{folderName}</dd>
          <dt>{t('storage.existing.file')}</dt>
          <dd>{`${DATABASE_FILE_NAME}(${formatFileSize(info.size)})`}</dd>
          <dt>{t('confirm.lastModified')}</dt>
          <dd>{formatDateTime(info.lastModified)}</dd>
        </dl>
        <label className="unsaved-dialog__choice">
          <input type="radio" name="storage-existing" checked={choice === 'open'} onChange={() => onChoice('open')} />
          <span>
            <b>{t('storage.existing.open.title')}</b>
            <br />
            <span className="settings__hint">{t('storage.existing.open.description')}</span>
          </span>
        </label>
        <label className="unsaved-dialog__choice">
          <input type="radio" name="storage-existing" checked={choice === 'copy'} onChange={() => onChoice('copy')} />
          <span>
            <b>{t('storage.existing.overwrite.title')}</b>
            <br />
            <span className="settings__hint settings__danger-text">{t('storage.existing.overwrite.description')}</span>
          </span>
        </label>
        <div className="unsaved-dialog__actions">
          <button type="button" className="unsaved-dialog__button" onClick={onCancel}>
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            className={`unsaved-dialog__button ${choice === 'copy' ? 'settings__button--danger' : 'unsaved-dialog__button--primary'}`}
            onClick={onSubmit}
          >
            {t('storage.existing.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface RevertDialogProps {
  choice: 'copy' | 'keep'
  onChoice: (choice: 'copy' | 'keep') => void
  onExportFirst: () => void
  onCancel: () => void
  onSubmit: () => void
}

/**
 * フォルダからブラウザ内へ戻すときの確認(計画Issue #174)。ブラウザ内のデータはフォルダに切り替えた
 * 時点のままで古いため、どちらを使うかを選ばせる。既定は、切り替え後の入力が消えない「フォルダの最新をコピー」。
 */
function RevertDialog({ choice, onChoice, onExportFirst, onCancel, onSubmit }: RevertDialogProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="unsaved-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="storage-revert-title" className="unsaved-dialog">
        <h2 id="storage-revert-title" className="unsaved-dialog__title">
          {t('storage.revertDialog.title')}
        </h2>
        <p className="unsaved-dialog__message">{t('storage.revertDialog.message')}</p>
        <label className="unsaved-dialog__choice">
          <input type="radio" name="storage-revert" checked={choice === 'copy'} onChange={() => onChoice('copy')} />
          <span>
            <b>{t('storage.revertDialog.copy.title')}</b>
            <span className="settings__badge">{t('storage.revertDialog.recommended')}</span>
            <br />
            <span className="settings__hint">{t('storage.revertDialog.copy.description')}</span>
          </span>
        </label>
        <label className="unsaved-dialog__choice">
          <input type="radio" name="storage-revert" checked={choice === 'keep'} onChange={() => onChoice('keep')} />
          <span>
            <b>{t('storage.revertDialog.keep.title')}</b>
            <br />
            <span className="settings__hint settings__danger-text">{t('storage.revertDialog.keep.description')}</span>
          </span>
        </label>
        <div className="settings__export-first">
          <span className="settings__hint">{t('confirm.exportFirst')}</span>
          <button type="button" className="settings__button settings__button--small" onClick={onExportFirst}>
            {t('confirm.exportFirstButton')}
          </button>
        </div>
        <p className="settings__hint">{t('storage.revertDialog.folderKept')}</p>
        <div className="unsaved-dialog__actions">
          <button type="button" className="unsaved-dialog__button" onClick={onCancel}>
            {t('confirm.cancel')}
          </button>
          <button type="button" className="unsaved-dialog__button unsaved-dialog__button--primary" onClick={onSubmit}>
            {t('storage.revertDialog.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
