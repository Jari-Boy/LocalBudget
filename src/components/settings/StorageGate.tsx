import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { StartupStorage } from '../../infrastructure/storage/resolveStartupStorage'
import '../common/unsaved-changes/UnsavedChangesDialog.css'
import './SettingsScreen.css'

export interface StorageGateProps {
  /** 起動時に保存先がそのまま開けるかを判定する(本番はresolveStartupStorage) */
  resolve: () => Promise<StartupStorage>
  /** フォルダのreadwrite権限を再要求する。クリック操作の中で呼ばれる。得られたらtrue(本番はensureReadWritePermission) */
  reconnect: (handle: FileSystemDirectoryHandle) => Promise<boolean>
  /** 保存先の選択をブラウザ内に戻す(本番はsaveStorageConfig({ kind: 'indexeddb' })) */
  revertToIndexedDb: () => Promise<void>
  /** ページを再読み込みする(本番はwindow.location.reload) */
  reload: () => void
  children: ReactNode
}

type GateState = { kind: 'checking' } | StartupStorage

/**
 * 起動時の保存先ゲート(計画Issue #174)。Workerを作る前に保存先がそのまま開けるかを判定し、
 * 開けるなら子要素(アプリ本体)を出す。フォルダの権限が「確認が必要」に戻っているときは、DBを
 * 開かずに再接続画面を出す(権限の再要求はユーザーのクリックの中でしかできない)。
 */
export function StorageGate({ resolve, reconnect, revertToIndexedDb, reload, children }: StorageGateProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<GateState>({ kind: 'checking' })

  useEffect(() => {
    let cancelled = false
    void resolve().then((resolved) => {
      if (!cancelled) setState(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [resolve])

  if (state.kind === 'checking') return <p role="status">{t('loading')}</p>
  if (state.kind === 'ready') return <>{children}</>

  return (
    <FolderReconnectScreen
      folderName={state.folderName}
      onReconnect={async () => {
        if (state.handle && (await reconnect(state.handle))) {
          setState({ kind: 'ready' })
          return true
        }
        return false
      }}
      canReconnect={state.handle !== null}
      onRevert={async () => {
        await revertToIndexedDb()
        reload()
      }}
    />
  )
}

interface FolderReconnectScreenProps {
  folderName: string | null
  /** ハンドルが残っているときだけ再接続できる */
  canReconnect: boolean
  onReconnect: () => Promise<boolean>
  onRevert: () => Promise<void>
}

/** 「フォルダに再接続」画面(計画Issue #174、承認済みモックアップ)。 */
function FolderReconnectScreen({ folderName, canReconnect, onReconnect, onRevert }: FolderReconnectScreenProps) {
  const { t } = useTranslation('settings')
  const [denied, setDenied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [revertFailed, setRevertFailed] = useState(false)

  async function handleReconnect() {
    setDenied(false)
    if (!(await onReconnect())) setDenied(true)
  }

  async function handleRevert() {
    setReverting(true)
    setRevertFailed(false)
    try {
      await onRevert()
    } catch {
      setReverting(false)
      setRevertFailed(true)
      setConfirming(false)
    }
  }

  return (
    <div className="settings__reconnect">
      <section className="settings__card settings__reconnect-card">
        <h1 className="settings__reconnect-title">{t('reconnect.title')}</h1>
        {canReconnect && folderName !== null ? (
          <p className="settings__reconnect-message">
            {t('reconnect.messageBefore')}
            <b>{folderName}</b>
            {t('reconnect.messageAfter')}
          </p>
        ) : (
          <p className="settings__reconnect-message">{t('reconnect.missing')}</p>
        )}
        <p className="settings__hint">{t('reconnect.hint')}</p>
        {denied && (
          <div role="alert" className="settings__error">
            {t('reconnect.denied')}
          </div>
        )}
        {revertFailed && (
          <div role="alert" className="settings__error">
            {t('reconnect.revertFailed')}
          </div>
        )}
        <div className="settings__reconnect-actions">
          {canReconnect && (
            <button
              type="button"
              className="settings__button settings__button--primary settings__button--large"
              onClick={() => void handleReconnect()}
            >
              {t('reconnect.button')}
            </button>
          )}
          <button type="button" className="settings__button settings__button--large" onClick={() => setConfirming(true)}>
            {t('reconnect.revert')}
          </button>
        </div>
        <p className="settings__hint">{t('reconnect.revertNote')}</p>
      </section>

      {confirming && (
        <div className="unsaved-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby="reconnect-revert-title" className="unsaved-dialog">
            <h2 id="reconnect-revert-title" className="unsaved-dialog__title">
              {t('reconnect.confirm.title')}
            </h2>
            <p className="unsaved-dialog__message">{t('reconnect.confirm.message')}</p>
            <div className="unsaved-dialog__actions">
              <button type="button" className="unsaved-dialog__button" disabled={reverting} onClick={() => setConfirming(false)}>
                {t('reconnect.confirm.cancel')}
              </button>
              <button
                type="button"
                className="unsaved-dialog__button unsaved-dialog__button--primary"
                disabled={reverting}
                onClick={() => void handleRevert()}
              >
                {t('reconnect.confirm.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
