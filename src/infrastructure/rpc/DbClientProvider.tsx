import * as Comlink from 'comlink'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepositoryRegistry } from './createRepositoryRegistry'
import { StartupErrorScreen } from '../../components/settings/StartupErrorScreen'
import { backupFileName } from '../../components/settings/backupFileName'
import { downloadDatabaseBackup } from '../backup/downloadDatabaseBackup'
import { updateApp } from '../pwa/updateApp'
import { createDbClient } from './createDbClient'
import { WorkerInitError } from './WorkerInitError'

export type DbClient = Comlink.Remote<RepositoryRegistry>

const DbClientContext = createContext<DbClient | null>(null)

/**
 * Web Worker起動(createDbClient、docs/architecture.md 5章)を1回だけ実行し、
 * 完了までは子要素の代わりにローディング表示を出す。起動完了後はComlinkの
 * RPCクライアントをContext経由で配下のコンポーネントへ供給する。
 */
export function DbClientProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [client, setClient] = useState<DbClient | null>(null)
  const [startupError, setStartupError] = useState<WorkerInitError | null>(null)

  useEffect(() => {
    let cancelled = false
    createDbClient().then(
      (createdClient) => {
        if (!cancelled) {
          // ComlinkのRemoteオブジェクトは内部的にfunction()を対象としたProxyであり
          // typeof演算子で"function"と判定される。setState(x)にそのまま渡すと、
          // Reactがxを「更新関数」と誤認しx(prevState)のように呼び出してしまい、
          // path=[]のAPPLYメッセージがWorkerに送られて例外になる。
          // setState(() => x)の形で渡し、Reactに関数呼び出しをさせず値として設定する。
          setClient(() => createdClient)
        }
      },
      (error: unknown) => {
        // 起動に失敗したら、読み込み中のまま止めずに種類に応じた起動エラー画面を出す(計画Issue #42)
        if (!cancelled) {
          setStartupError(
            error instanceof WorkerInitError
              ? error
              : new WorkerInitError(error instanceof Error ? error.message : String(error)),
          )
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (startupError) {
    return (
      <StartupErrorScreen
        error={startupError}
        onExport={(data) => downloadDatabaseBackup(data, backupFileName(new Date()))}
        onUpdate={() => updateApp({ container: navigator.serviceWorker, reload: () => window.location.reload() })}
        onReload={() => window.location.reload()}
      />
    )
  }

  if (!client) {
    return <p role="status">{t('loading')}</p>
  }

  return <DbClientContext.Provider value={client}>{children}</DbClientContext.Provider>
}

/**
 * DbClientProvider配下のコンポーネントからRPCクライアントを取得するフック。
 * Provider外で呼び出された場合は実装ミスとして即座に例外を投げる。
 */
export function useDbClient(): DbClient {
  const client = useContext(DbClientContext)
  if (!client) {
    throw new Error('useDbClient must be used within DbClientProvider')
  }
  return client
}
