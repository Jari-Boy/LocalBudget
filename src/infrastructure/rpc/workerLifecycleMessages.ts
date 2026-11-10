/**
 * db.worker.tsとcreateDbClient(メインスレッド)間で、Comlink自身のメッセージ(idを持つ)
 * とは別チャネルとしてやり取りする初期化ライフサイクル通知。Comlink側のリスナーは
 * idを持たないこれらのメッセージを無視する(node_modules/comlink実装のid有無チェックによる)。
 */
export const WORKER_READY_MESSAGE = { type: 'worker-ready' } as const

/**
 * 書き込みの権利(Web Locks、計画Issue #174)を取れなかったページが起動するWorkerに付ける名前。
 * 権利の取得はページ(メインスレッド)で1回だけ行い、結果をWorkerの名前で渡す。Workerごとに取ると、
 * 開発時のStrictModeが作る使われないWorkerがロックを握り、本来のWorkerが読み取り専用になってしまう。
 */
export const READ_ONLY_WORKER_NAME = 'db-worker-read-only'
export const WRITABLE_WORKER_NAME = 'db-worker'

const WORKER_INIT_ERROR_TYPE = 'worker-init-error'

export interface WorkerInitErrorMessage {
  type: typeof WORKER_INIT_ERROR_TYPE
  message: string
}

/**
 * db.worker.ts側でDB初期化(WASM読み込み・マイグレーション等)が失敗した際に送出する
 * メッセージを組み立てる。エラーの型情報(instanceof)はここでは保持しない
 * (初期化失敗はリトライ以外の取りうる対応がないため、詳細な型分岐は不要と判断)。
 */
export function createWorkerInitErrorMessage(error: unknown): WorkerInitErrorMessage {
  return {
    type: WORKER_INIT_ERROR_TYPE,
    message: error instanceof Error ? error.message : String(error),
  }
}

export function isWorkerInitErrorMessage(data: unknown): data is WorkerInitErrorMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === WORKER_INIT_ERROR_TYPE
  )
}
