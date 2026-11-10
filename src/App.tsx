import { HashRouter } from 'react-router'
import { StorageGate } from './components/settings/StorageGate'
import { DbClientProvider } from './infrastructure/rpc/DbClientProvider'
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
 * アプリシェル(計画Issue #118)。ホスティング先が未定で静的配信前提のため、
 * サーバー側のSPAフォールバックリライトに依存しない`HashRouter`を採用している
 * (判断根拠はdocs/decisions.md参照)。ルート定義自体は`AppRoutes`に切り出しており、
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
            <AppRoutes />
          </DbClientProvider>
        </StorageGate>
      </HashRouter>
      <UpdateBanner />
      <IosInstallPrompt />
    </>
  )
}

export default App
