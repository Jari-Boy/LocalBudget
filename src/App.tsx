import { HashRouter } from 'react-router'
import { DbClientProvider } from './infrastructure/rpc/DbClientProvider'
import { AppRoutes } from './routes/AppRoutes'
import { UpdateBanner } from './components/UpdateBanner'
import { IosInstallPrompt } from './components/IosInstallPrompt'

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
        <DbClientProvider>
          <AppRoutes />
        </DbClientProvider>
      </HashRouter>
      <UpdateBanner />
      <IosInstallPrompt />
    </>
  )
}

export default App
