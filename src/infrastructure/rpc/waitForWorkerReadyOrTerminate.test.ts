/**
 * waitForWorkerReadyOrTerminate のユニットテスト。
 * Worker初期化に失敗した場合、生成済みのWorkerインスタンスがterminate()されないまま
 * 参照を失うと、失敗のたびにWorkerが破棄されず残り続ける懸念がある(evaluator Review
 * Attempt 2の所見、Human Override REJECTで今回のAttemptでの対応が指示された)。
 * 本関数はwaitForWorkerReadyの結果を見て、失敗時のみterminate()を呼んでから
 * 例外を再スローする。EventTarget+terminate()のみに依存する設計にし、Node組み込みの
 * EventTargetを継承した最小限のモックでテストする。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { waitForWorkerReadyOrTerminate } from './waitForWorkerReadyOrTerminate'
import { WORKER_READY_MESSAGE } from './workerLifecycleMessages'

class MockWorker extends EventTarget {
  terminateCallCount = 0
  terminate(): void {
    this.terminateCallCount += 1
  }
}

describe('waitForWorkerReadyOrTerminate', () => {
  it('準備完了した場合はterminateを呼ばない', async () => {
    const worker = new MockWorker()
    const promise = waitForWorkerReadyOrTerminate(worker)

    worker.dispatchEvent(new MessageEvent('message', { data: WORKER_READY_MESSAGE }))
    await promise

    expect(worker.terminateCallCount).toBe(0)
  })

  it('worker-init-errorメッセージで失敗した場合、terminateしてから元のエラーを再スローする', async () => {
    const worker = new MockWorker()
    const promise = waitForWorkerReadyOrTerminate(worker)

    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'worker-init-error', message: 'wasm load failed' },
      }),
    )

    await expect(promise).rejects.toThrow('wasm load failed')
    expect(worker.terminateCallCount).toBe(1)
  })

  it('errorイベントで失敗した場合もterminateしてから再スローする', async () => {
    const worker = new MockWorker()
    const promise = waitForWorkerReadyOrTerminate(worker)

    worker.dispatchEvent(new Event('error'))

    await expect(promise).rejects.toThrow()
    expect(worker.terminateCallCount).toBe(1)
  })
})
