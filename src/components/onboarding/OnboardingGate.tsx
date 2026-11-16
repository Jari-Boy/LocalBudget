import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnboardingRpcApi, OnboardingStatus } from '../../infrastructure/rpc/createOnboardingApi'
import type { StorageRpcApi } from '../../infrastructure/rpc/createStorageApi'
import type { FolderPicker } from '../../infrastructure/storage/browserFolderPicker'
import { SetupScreen, type FolderChoice, type SetupValues } from './SetupScreen'
import { WelcomeScreen } from './WelcomeScreen'
import './onboarding.css'

export interface OnboardingGateProps {
  /** 初回セットアップのWorker側API(RPC越しなのでPromiseで受ける) */
  onboarding: {
    getStatus(): Promise<OnboardingStatus>
    complete: (input: Parameters<OnboardingRpcApi['complete']>[0]) => Promise<void>
    /** 確定に失敗したときの逃げ道(何も変えずに、初回セットアップを済んだことにする) */
    skip: () => Promise<void>
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
 * (ウェルカムにスキップの導線は無い。完了の印を付けるのは、初期設定の確定と、確定に失敗したときだけ出す
 * 「設定せずに始める」。既存のデータを開く場合は、開いた先のDBの印で決まる)。
 * StorageGate(保存先が開けるかの確認)を通ったあと、DbClientProviderの内側に置くので、起動時の他の表示
 * (保存先の再接続・更新バナー・iOSの案内)と競合しない。
 * フォルダは、ブラウザが操作の直後にしか選ばせないため、選ぶ操作(ウェルカムの「既存のデータを開く」、初期設定で
 * 「フォルダに保存」を選んだとき)の中で選ぶ。フォルダに既存のデータがあるときは、上書きせず、そのまま開く
 * ('open')。空のフォルダなら、設定を確定してから今のデータをコピー('copy')して再読み込みする。切り替えに失敗したときは、
 * 設定は確定済みなので、ブラウザ内のまま始められる。
 */
export function OnboardingGate({ onboarding, storage, folderPicker, reload, children }: OnboardingGateProps) {
  const { t } = useTranslation('onboarding')
  const { t: tc } = useTranslation()
  const [view, setView] = useState<View>('checking')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

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

  /** ウェルカムの「既存のデータを開く」: フォルダを選び、既存のデータがあればそのまま開く */
  async function handleOpenExisting() {
    setOpenError(null)
    let folder: FileSystemDirectoryHandle | null
    let hasData: boolean
    try {
      folder = await folderPicker.pick()
      if (folder === null) return
      hasData = (await folderPicker.describe(folder)) !== null
    } catch {
      setOpenError(t('welcome.openExisting.failed'))
      return
    }
    if (!hasData) {
      setOpenError(t('welcome.openExisting.empty'))
      return
    }
    try {
      await storage.moveToFolder(folder, 'open')
      reload()
    } catch {
      setOpenError(t('welcome.openExisting.failed'))
    }
  }

  /** 初期設定で「フォルダに保存」を選んだとき: フォルダを選び、既存のデータがあるかを調べる。取りやめならnull */
  async function chooseFolder(): Promise<FolderChoice | null> {
    const folder = await folderPicker.pick()
    if (folder === null) return null
    const info = await folderPicker.describe(folder)
    return { handle: folder, name: folder.name, hasExistingData: info !== null }
  }

  /** 初期設定で既存のデータがあるフォルダを選び、「このデータを読み込む」を押したとき。失敗は呼び出し元が表示する */
  async function loadExistingFolder(folder: FileSystemDirectoryHandle): Promise<void> {
    await storage.moveToFolder(folder, 'open')
    reload()
  }

  /** 確定に失敗したときの逃げ道。何も変えずに済んだことにして、アプリ本体へ進む(記録に失敗しても、このセッションは進める) */
  async function handleSkipAfterFailure() {
    try {
      await onboarding.skip()
    } catch {
      // 印を付けられなくても、利用は妨げない(次回また初期設定が出る)
    }
    setView('ready')
  }

  async function handleSubmit(values: SetupValues) {
    setSubmitting(true)
    setError(null)

    try {
      await onboarding.complete({ memberName: values.memberName, template: values.template })
    } catch {
      setError(t('setup.failed'))
      setSubmitting(false)
      return
    }

    if (values.folder) {
      try {
        await storage.moveToFolder(values.folder, 'copy')
        reload()
        return
      } catch {
        setSubmitting(false)
        setView('folderFailed')
        return
      }
    }
    setSubmitting(false)
    setView('ready')
  }

  if (view === 'checking') return <p role="status">{tc('loading')}</p>
  if (view === 'ready') return <>{children}</>
  if (view === 'setup') {
    return (
      <SetupScreen
        folderSupported={folderPicker.isSupported}
        submitting={submitting}
        error={error}
        onChooseFolder={chooseFolder}
        onLoadFolder={loadExistingFolder}
        onSkip={() => void handleSkipAfterFailure()}
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
  return (
    <WelcomeScreen
      onNext={() => setView('setup')}
      onOpenExisting={() => void handleOpenExisting()}
      folderSupported={folderPicker.isSupported}
      error={openError}
    />
  )
}
