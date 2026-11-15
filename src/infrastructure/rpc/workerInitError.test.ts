/**
 * Worker初期化エラーの種類付き伝達のユニットテスト(計画Issue #42)。
 * db.worker.tsはStartupDatabaseError(新しすぎるバージョン・移行の失敗)を、種類・元のDBのバイト列・
 * バージョン番号を添えたworker-init-errorメッセージにする。メインスレッド側のwaitForWorkerReadyは
 * それをWorkerInitErrorとしてrejectし、画面が種類ごとに案内と「元のデータを書き出す」を出せるようにする。
 * 外部依存: なし(Node組み込みのEventTargetでWorkerを模す)。
 */
import { describe, expect, it } from 'vitest'
import { StartupDatabaseError } from '../db/openMigratedDatabase'
import { WorkerInitError } from './WorkerInitError'
import { waitForWorkerReady } from './waitForWorkerReady'
import { createWorkerInitErrorMessage } from './workerLifecycleMessages'

describe('createWorkerInitErrorMessage', () => {
  it('StartupDatabaseErrorは、種類・元のバイト列・バージョンを添える', () => {
    const original = new Uint8Array([1, 2])
    const error = new StartupDatabaseError('schema-too-new', 'too new', {
      originalData: original,
      databaseVersion: 5,
      latestVersion: 2,
    })

    expect(createWorkerInitErrorMessage(error)).toEqual({
      type: 'worker-init-error',
      message: 'too new',
      reason: 'schema-too-new',
      originalData: original,
      databaseVersion: 5,
      latestVersion: 2,
    })
  })

  it('それ以外のエラーはreasonがotherで、元のバイト列を持たない', () => {
    expect(createWorkerInitErrorMessage(new Error('wasm'))).toEqual({
      type: 'worker-init-error',
      message: 'wasm',
      reason: 'other',
    })
  })
})

describe('waitForWorkerReady(種類付きエラー)', () => {
  it('種類付きのworker-init-errorは、reasonと元のバイト列を持つWorkerInitErrorでrejectする', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)
    const original = new Uint8Array([7])

    target.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'worker-init-error', message: 'failed', reason: 'migration-failed', originalData: original },
      }),
    )

    const error = (await promise.catch((e: unknown) => e)) as WorkerInitError
    expect(error).toBeInstanceOf(WorkerInitError)
    expect(error.reason).toBe('migration-failed')
    expect(error.originalData).toEqual(original)
    expect(error.message).toBe('failed')
  })

  it('reasonの無い従来のメッセージはreasonがotherのWorkerInitErrorになる', async () => {
    const target = new EventTarget()
    const promise = waitForWorkerReady(target)

    target.dispatchEvent(new MessageEvent('message', { data: { type: 'worker-init-error', message: 'x' } }))

    const error = (await promise.catch((e: unknown) => e)) as WorkerInitError
    expect(error.reason).toBe('other')
    expect(error.originalData).toBeNull()
  })
})
