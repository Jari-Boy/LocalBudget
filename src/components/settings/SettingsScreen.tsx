import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { InvalidBackupFileError } from '../../infrastructure/backup/InvalidBackupFileError'
import { fromDatabaseFile } from '../../infrastructure/storage/databaseFileCodec'
import '../common/unsaved-changes/UnsavedChangesDialog.css'
import { loadUnsavedWarningEnabled, saveUnsavedWarningEnabled } from '../common/unsaved-changes/unsavedWarningSetting'
import { backupFileName } from './backupFileName'
import { formatDateTime, formatFileSize } from './fileInfoFormat'
import { markImportCompleted, takeImportNotice, type NoticeStorage } from './importNotice'
import { StorageSection, type FolderPicker, type StorageApi } from './StorageSection'
import './SettingsScreen.css'

/** 設定画面が使うWorker側のバックアップAPI(RepositoryRegistry.backup、計画Issue #26)。 */
export interface BackupApi {
  export(): Promise<Uint8Array>
  importDatabase(data: Uint8Array): Promise<void>
}

export interface SettingsScreenProps {
  backup: BackupApi
  /** 保存先の状態の取得と切り替え(Worker側、計画Issue #174) */
  storage: StorageApi
  /** フォルダ選択(メインスレッド、計画Issue #174) */
  folderPicker: FolderPicker
  /** DBのバイト列をファイルとしてダウンロードさせる(本番はdownloadDatabaseBackup) */
  download: (data: Uint8Array, fileName: string) => void
  /** ページを再読み込みし、Workerに読み込んだDBを読み直させる(本番はwindow.location.reload) */
  reload: () => void
  /** 読み込み後のお知らせの印を置く場所(本番はsessionStorage) */
  noticeStorage: NoticeStorage
  /** 書き出しのファイル名に入れる日時 */
  now?: () => Date
}

type ImportState =
  | { kind: 'idle' }
  | { kind: 'confirm'; file: File }
  | { kind: 'importing'; file: File }
  | { kind: 'invalid'; file: File }
  | { kind: 'failed'; file: File }

/**
 * 設定画面(計画Issue #173)。データの保存先の表示と、バックアップの書き出し・読み込みを置く。
 * 保存先の表示と切り替え(ブラウザ内/フォルダ、計画Issue #174)はStorageSectionが受け持つ。
 *
 * 読み込みは、ファイルを選ぶ → 確認ダイアログ(置き換えて元に戻せないこと、直前の書き出し)
 * → 読み込み中 → 成功ならお知らせの印を残してページを再読み込みする。Worker内のDBは
 * 差し替えず、再読み込みで起動し直したWorkerが保存先から読み直す(docs/architecture.md 8章)。
 * Worker側が検証で拒否した(InvalidBackupFileError)場合は、今のデータを変えていないことを伝える。
 * それ以外の失敗(保存先への書き込み失敗等)は、Worker側で自動保存を止めた後の可能性があるため、
 * ページの読み込み直しを促す。
 */
export function SettingsScreen({
  backup,
  storage,
  folderPicker,
  download,
  reload,
  noticeStorage,
  now = () => new Date(),
}: SettingsScreenProps) {
  const { t } = useTranslation('settings')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [exportFailed, setExportFailed] = useState(false)
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const [unsavedWarning, setUnsavedWarning] = useState(loadUnsavedWarningEnabled)

  useEffect(() => {
    // StrictModeで2回呼ばれても、2回目は印が消えていてnullになるため上書きしない
    const fileName = takeImportNotice(noticeStorage)
    if (fileName !== null) setImportedFileName(fileName)
  }, [noticeStorage])

  async function handleExport() {
    setExportFailed(false)
    try {
      download(await backup.export(), backupFileName(now()))
    } catch {
      setExportFailed(true)
    }
  }

  function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 同じファイルを選び直しても change が起きるよう、選択を空にしておく
    event.target.value = ''
    if (file) setImportState({ kind: 'confirm', file })
  }

  async function handleImport(file: File) {
    setImportState({ kind: 'importing', file })
    try {
      await backup.importDatabase(await fromDatabaseFile(file))
    } catch (error) {
      setImportState({ kind: error instanceof InvalidBackupFileError ? 'invalid' : 'failed', file })
      return
    }
    markImportCompleted(file.name, noticeStorage)
    reload()
  }

  const closeDialog = () => setImportState({ kind: 'idle' })

  return (
    <div className="settings">
      <h1 className="settings__title">{t('title')}</h1>

      {importedFileName !== null && (
        <div role="status" className="settings__notice">
          <span className="settings__notice-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t('notice.imported', { fileName: importedFileName })}
          </span>
          <button
            type="button"
            className="settings__notice-close"
            aria-label={t('notice.closeLabel')}
            onClick={() => setImportedFileName(null)}
          >
            {t('notice.close')}
          </button>
        </div>
      )}

      <StorageSection
        storage={storage}
        folderPicker={folderPicker}
        exportCurrent={() => void handleExport()}
        reload={reload}
      />

      <section className="settings__card" aria-labelledby="settings-unsaved-heading">
        <h2 id="settings-unsaved-heading" className="settings__card-title">
          {t('unsavedWarning.heading')}
        </h2>
        <div className="settings__row">
          <div className="settings__row-text">
            <label htmlFor="settings-unsaved-warning" className="settings__strong">
              {t('unsavedWarning.label')}
            </label>
            <div className="settings__hint">{t('unsavedWarning.description')}</div>
            <div className="settings__hint">
              <b className="settings__warning">{t('unsavedWarning.warning')}</b>
            </div>
          </div>
          <input
            id="settings-unsaved-warning"
            type="checkbox"
            className="settings__checkbox"
            checked={unsavedWarning}
            onChange={(event) => {
              setUnsavedWarning(event.target.checked)
              saveUnsavedWarningEnabled(event.target.checked)
            }}
          />
        </div>
        <div className="settings__hint">{t('unsavedWarning.scope')}</div>
      </section>

      <section className="settings__card" aria-labelledby="settings-backup-heading">
        <h2 id="settings-backup-heading" className="settings__card-title">
          {t('backup.heading')}
        </h2>

        <div className="settings__row">
          <div className="settings__row-text">
            <div className="settings__strong">{t('backup.export.title')}</div>
            <div className="settings__hint">{t('backup.export.description')}</div>
            <div className="settings__example">
              {t('backup.export.fileNameExample', { fileName: backupFileName(now()) })}
            </div>
            {exportFailed && (
              <div role="alert" className="settings__error">
                {t('backup.export.failed')}
              </div>
            )}
          </div>
          <button type="button" className="settings__button settings__button--primary" onClick={() => void handleExport()}>
            {t('backup.export.button')}
          </button>
        </div>

        <div className="settings__row">
          <div className="settings__row-text">
            <div className="settings__strong">{t('backup.import.title')}</div>
            <div className="settings__hint">
              {t('backup.import.description')}
              <b className="settings__warning">{t('backup.import.warning')}</b>
            </div>
          </div>
          <button type="button" className="settings__button" onClick={() => fileInputRef.current?.click()}>
            {t('backup.import.button')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            aria-label={t('backup.import.fileInputLabel')}
            onChange={handleFileChosen}
          />
        </div>
      </section>

      {(importState.kind === 'confirm' || importState.kind === 'importing') && (
        <ImportConfirmDialog
          file={importState.file}
          busy={importState.kind === 'importing'}
          onExportFirst={() => void handleExport()}
          onCancel={closeDialog}
          onConfirm={() => void handleImport(importState.file)}
        />
      )}

      {(importState.kind === 'invalid' || importState.kind === 'failed') && (
        <div className="unsaved-dialog__backdrop">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="settings-import-error-title"
            className="unsaved-dialog"
          >
            <h2 id="settings-import-error-title" className="unsaved-dialog__title settings__danger-text">
              {t(`${importState.kind}.title`)}
            </h2>
            <div className="settings__file-box">{importState.file.name}</div>
            <p className="unsaved-dialog__message">{t(`${importState.kind}.message`)}</p>
            {importState.kind === 'invalid' && (
              <p className="unsaved-dialog__message">
                <b>{t('invalid.unchanged')}</b>
              </p>
            )}
            <div className="unsaved-dialog__actions">
              <button
                type="button"
                className="unsaved-dialog__button unsaved-dialog__button--primary"
                onClick={closeDialog}
              >
                {t(`${importState.kind}.close`)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface ImportConfirmDialogProps {
  file: File
  /** 読み込み中。表示を切り替え、ボタンを押せなくする */
  busy: boolean
  onExportFirst: () => void
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 読み込みの確認と読み込み中の表示(計画Issue #173)。どちらも同じ位置に出し、読み込み中は
 * 見出しと本文を差し替えてボタンを押せなくする(二重の読み込みと途中のキャンセルを防ぐ)。
 */
function ImportConfirmDialog({ file, busy, onExportFirst, onCancel, onConfirm }: ImportConfirmDialogProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="unsaved-dialog__backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-import-title"
        aria-busy={busy}
        className="unsaved-dialog"
      >
        <h2 id="settings-import-title" className="unsaved-dialog__title">
          {busy ? t('importing.title') : t('confirm.title')}
        </h2>
        {busy ? (
          <>
            <div className="settings__progress" role="progressbar" aria-label={t('importing.progress')}>
              <div className="settings__progress-bar" />
            </div>
            <p className="unsaved-dialog__message">{t('importing.message')}</p>
            <p className="settings__hint">{t('importing.keepOpen')}</p>
          </>
        ) : (
          <>
            <dl className="settings__file-info">
              <dt>{t('confirm.file')}</dt>
              <dd className="settings__strong">{file.name}</dd>
              <dt>{t('confirm.size')}</dt>
              <dd>{formatFileSize(file.size)}</dd>
              <dt>{t('confirm.lastModified')}</dt>
              <dd>{formatDateTime(file.lastModified)}</dd>
            </dl>
            <p className="unsaved-dialog__message">
              <b>{t('confirm.message')}</b>
            </p>
            <div className="settings__export-first">
              <span className="settings__hint">{t('confirm.exportFirst')}</span>
              <button type="button" className="settings__button settings__button--small" onClick={onExportFirst}>
                {t('confirm.exportFirstButton')}
              </button>
            </div>
          </>
        )}
        <div className="unsaved-dialog__actions">
          <button type="button" className="unsaved-dialog__button" disabled={busy} onClick={onCancel}>
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            className="unsaved-dialog__button settings__button--danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {t('confirm.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
