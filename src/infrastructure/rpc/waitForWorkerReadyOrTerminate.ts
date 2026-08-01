import { waitForWorkerReady } from './waitForWorkerReady'

type TerminatableWorker = EventTarget & { terminate(): void }

/**
 * waitForWorkerReadyの結果を見て、失敗時のみWorkerをterminate()してから元の
 * エラーを再スローする。terminate()を呼ばないまま参照を失うと、初期化失敗の
 * たびにWorkerが破棄されず残り続けるため(evaluator所見への対応、Human Override
 * REJECT参照)、失敗経路を一本化してここでterminateを保証する。
 */
export async function waitForWorkerReadyOrTerminate(worker: TerminatableWorker): Promise<void> {
  try {
    await waitForWorkerReady(worker)
  } catch (error) {
    worker.terminate()
    throw error
  }
}
