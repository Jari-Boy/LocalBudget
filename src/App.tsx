import type * as Comlink from 'comlink'
import { useMemo, type ReactNode } from 'react'
import { HashRouter } from 'react-router'
import { OnboardingGate } from './components/onboarding/OnboardingGate'
import { StorageGate } from './components/settings/StorageGate'
import type { StorageApi } from './components/settings/StorageSection'
import type { OnboardingRpcApi } from './infrastructure/rpc/createOnboardingApi'
import { DbClientProvider, useDbClient } from './infrastructure/rpc/DbClientProvider'
import { browserFolderPicker } from './infrastructure/storage/browserFolderPicker'
import { loadDirectoryHandle } from './infrastructure/storage/directoryHandleStore'
import { ensureReadWritePermission } from './infrastructure/storage/ensureReadWritePermission'
import { resolveStartupStorage } from './infrastructure/storage/resolveStartupStorage'
import { loadStorageConfig, saveStorageConfig } from './infrastructure/storage/storageConfig'
import { AppRoutes } from './routes/AppRoutes'
import { UpdateBanner } from './components/UpdateBanner'
import { IosInstallPrompt } from './components/IosInstallPrompt'

/**
 * 起動時の保存先ゲートの実処理(計画Issue #174)。再レンダリングで作り直されないよう、モジュール直下に置く
 * (StorageGateはresolveの同一性を見て判定をやり直すため)。
 */
const resolveStorageAtStartup = () =>
  resolveStartupStorage({ loadConfig: loadStorageConfig, loadFolderHandle: loadDirectoryHandle })
const revertToIndexedDb = () => saveStorageConfig({ kind: 'indexeddb' })
const reloadPage = () => window.location.reload()

/**
 * 初回セットアップのゲートに、Worker側のAPIとブラウザのフォルダ選択を結ぶ(計画Issue #177)。
 * ComlinkのプロキシはプロパティアクセスのたびにProxyを作るため、clientにだけ依存させて安定化する(AppRoutesと同じ理由)。
 */
function OnboardingBoundary({ children }: { children: ReactNode }) {
  const client = useDbClient()
  const { onboarding, storage } = useMemo(
    () => ({
      onboarding: client.onboarding as unknown as Comlink.Remote<OnboardingRpcApi>,
      storage: client.storage as unknown as Comlink.Remote<StorageApi>,
    }),
    [client],
  )
  return (
    <OnboardingGate onboarding={onboarding} storage={storage} folderPicker={browserFolderPicker} reload={reloadPage}>
      {children}
    </OnboardingGate>
  )
}

/**
 * アプリシェル(計画Issue #118)。ホスティング先が未定で静的配信前提のため、
 * サーバー側のSPAフォールバックリライトに依存しない`HashRouter`を採用している
 * (判断根拠はdocs/decisions/参照)。ルート定義自体は`AppRoutes`に切り出しており、
 * 将来ホスティング先確定時に`BrowserRouter`へ切り替える場合もこのファイルの変更のみで済む。
 */
function App() {
  return (
    <>
      <HashRouter>
        <StorageGate
          resolve={resolveStorageAtStartup}
          reconnect={ensureReadWritePermission}
          revertToIndexedDb={revertToIndexedDb}
          reload={reloadPage}
        >
          <DbClientProvider>
            <OnboardingBoundary>
              <AppRoutes />
            </OnboardingBoundary>
          </DbClientProvider>
        </StorageGate>
      </HashRouter>
      <UpdateBanner />
      <IosInstallPrompt />
    </>
  )
}

export default App
