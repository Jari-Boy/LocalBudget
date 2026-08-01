/**
 * waitForWorkerReady のユニットテスト。
 * Worker初期化(sql.jsのWASM読み込み・マイグレーション等)が非同期のため、db.worker.tsは
 * 完了後にWORKER_READY_MESSAGEを、失敗時はworker-init-errorメッセージをpostMessageする。
 * 本関数はそれらのメッセージ(またはerrorイベント)を待ち受け、成功/失敗をPromiseとして
 * 表現する。EventTargetの標準APIのみに依存するため、Node組み込みのEventTargetで
 * Workerの挙動をシミュレートしてテストする。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { waitForWorkerReady } from './waitForWorkerReady'
import { WORKER_READY_MESSAGE } from './workerLifecycleMessages'

describe('waitForWorkerReady', () => {
  it('WORKER_READY_MESSAGEを受信したらresolveする', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)

    target.dispatchEvent(new MessageEvent('message', { data: WORKER_READY_MESSAGE }))

    await expect(promise).resolves.toBeUndefined()
  })

  it('worker-init-errorメッセージを受信したらそのメッセージでrejectする', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)

    target.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'worker-init-error', message: 'wasm load failed' },
      }),
    )

    await expect(promise).rejects.toThrow('wasm load failed')
  })

  it('errorイベントを受信したらrejectする', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)

    target.dispatchEvent(new Event('error'))

    await expect(promise).rejects.toThrow()
  })

  it('関係のないメッセージは無視して待ち続け、その後READYが届けばresolveする', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)

    target.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else' } }))
    target.dispatchEvent(new MessageEvent('message', { data: WORKER_READY_MESSAGE }))

    await expect(promise).resolves.toBeUndefined()
  })

  it('resolve後はmessage/errorのリスナーを解除する(二重解決を防ぐ)', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)
    target.dispatchEvent(new MessageEvent('message', { data: WORKER_READY_MESSAGE }))
    await promise

    expect(() =>
      target.dispatchEvent(new MessageEvent('message', { data: WORKER_READY_MESSAGE })),
    ).not.toThrow()
  })
})
