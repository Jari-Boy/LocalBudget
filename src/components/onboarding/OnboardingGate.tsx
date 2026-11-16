import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnboardingRpcApi, OnboardingStatus } from '../../infrastructure/rpc/createOnboardingApi'
import type { StorageRpcApi } from '../../infrastructure/rpc/createStorageApi'
import type { FolderPicker } from '../../infrastructure/storage/browserFolderPicker'
import { SetupScreen, type SetupValues } from './SetupScreen'
import { WelcomeScreen } from './WelcomeScreen'
import './onboarding.css'

export interface OnboardingGateProps {
  /** 初回セットアップのWorker側API(RPC越しなのでPromiseで受ける) */
  onboarding: {
    getStatus(): Promise<OnboardingStatus>
    complete: (input: Parameters<OnboardingRpcApi['complete']>[0]) => Promise<void>
  }
  /** フォルダ保存に切り替えるWorker側API(設定画面と同じ) */
  storage: Pick<StorageRpcApi, 'moveToFolder'>
  folderPicker: FolderPicker
  /** ページを再読み込みし、Workerに新しい保存先から読み直させる(本番はwindow.location.reload) */
  reload: () => void
  children: ReactNode
}

type View = 'checking' | 'welcome' | 'setup' | 'folderFailed' | 'ready'

/**
 * 初回セットアップのゲート(計画Issue #177)。Workerの完了済みの印(DBの状態。保存先を切り替えても食い違わない)を見て、
 * 完了済み(既存の利用者を含む)ならアプリ本体を出し、未完了のときだけウェルカム → 初期設定の順に出す
 * (スキップの導線は無い。初期設定の確定が、完了の印を付ける唯一の経路)。
 * StorageGate(保存先が開けるかの確認)を通ったあと、DbClientProviderの内側に置くので、起動時の他の表示
 * (保存先の再接続・更新バナー・iOSの案内)と競合しない。
 * フォルダ保存を選んだときは、ユーザー操作の中でフォルダを先に選び(ブラウザはフォルダ選択を操作の直後にしか許さない)、
 * 設定を確定してから保存先を切り替えて再読み込みする。フォルダの選択を取りやめた・切り替えに失敗したときは、
 * 設定は確定済みなので、ブラウザ内のまま始められる。
 */
export function OnboardingGate({ onboarding, storage, folderPicker, reload, children }: OnboardingGateProps) {
  const { t } = useTranslation('onboarding')
  const { t: tc } = useTranslation()
  const [view, setView] = useState<View>('checking')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void onboarding
      .getStatus()
      .then((status) => {
        if (!cancelled) setView(status.completed ? 'ready' : 'welcome')
      })
      // 状態を読めないときは、利用を妨げないようアプリ本体を出す
      .catch(() => {
        if (!cancelled) setView('ready')
      })
    return () => {
      cancelled = true
    }
  }, [onboarding])

  async function handleSubmit(values: SetupValues) {
    setSubmitting(true)
    setError(null)

    let folder: FileSystemDirectoryHandle | null = null
    let existing = false
    let folderFailed = false
    if (values.storage === 'folder') {
      try {
        folder = await folderPicker.pick()
        if (folder) existing = (await folderPicker.describe(folder)) !== null
      } catch {
        folder = null
        folderFailed = true
      }
    }

    try {
      await onboarding.complete({ memberName: values.memberName, template: values.template })
    } catch {
      setError(t('setup.failed'))
      setSubmitting(false)
      return
    }

    if (folder) {
      try {
        // 既存のDBファイルがあるときは、上書きせずそのファイルを開く
        await storage.moveToFolder(folder, existing ? 'open' : 'copy')
        reload()
        return
      } catch {
        folderFailed = true
      }
    }
    setSubmitting(false)
    setView(folderFailed ? 'folderFailed' : 'ready')
  }

  if (view === 'checking') return <p role="status">{tc('loading')}</p>
  if (view === 'ready') return <>{children}</>
  if (view === 'setup') {
    return (
      <SetupScreen
        folderSupported={folderPicker.isSupported}
        submitting={submitting}
        error={error}
        onSubmit={(values) => void handleSubmit(values)}
        onBack={() => setView('welcome')}
      />
    )
  }
  if (view === 'folderFailed') {
    return (
      <div className="onboarding">
        <section className="onboarding__card">
          <div role="alert" className="onboarding__error-box">
            {t('folderFailed.message')}
          </div>
          <div className="onboarding__actions">
            <button type="button" className="onboarding__button onboarding__button--primary" onClick={() => setView('ready')}>
              {t('folderFailed.continue')}
            </button>
          </div>
        </section>
      </div>
    )
  }
  return <WelcomeScreen onNext={() => setView('setup')} />
}
