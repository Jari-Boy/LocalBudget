import { WORKER_READY_MESSAGE, isWorkerInitErrorMessage } from './workerLifecycleMessages'

/**
 * Worker初期化(sql.jsのWASM読み込み・マイグレーション等)完了を待ち受ける。
 * WORKER_READY_MESSAGEでresolve、worker-init-errorメッセージまたはerrorイベント
 * (スクリプト自体の読み込み失敗等)でrejectする。EventTargetの標準APIのみに依存する
 * ため、Node組み込みのEventTargetでもブラウザのWorkerでもテスト・実行できる。
 */
export function waitForWorkerReady(target: EventTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup(): void {
      target.removeEventListener('message', handleMessage)
      target.removeEventListener('error', handleError)
    }
    function handleMessage(event: Event): void {
      const data = (event as MessageEvent).data as unknown
      if (
        typeof data === 'object' &&
        data !== null &&
        (data as { type?: unknown }).type === WORKER_READY_MESSAGE.type
      ) {
        cleanup()
        resolve()
      } else if (isWorkerInitErrorMessage(data)) {
        cleanup()
        reject(new Error(data.message))
      }
    }
    function handleError(event: Event): void {
      cleanup()
      const message =
        'message' in event && typeof event.message === 'string'
          ? event.message
          : 'worker failed to initialize'
      reject(new Error(message))
    }
    target.addEventListener('message', handleMessage)
    target.addEventListener('error', handleError)
  })
}
