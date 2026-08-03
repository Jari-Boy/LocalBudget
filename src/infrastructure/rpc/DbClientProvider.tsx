import * as Comlink from 'comlink'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepositoryRegistry } from './createRepositoryRegistry'
import { createDbClient } from './createDbClient'

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

  useEffect(() => {
    let cancelled = false
    void createDbClient().then((createdClient) => {
      if (!cancelled) {
        setClient(createdClient)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

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
