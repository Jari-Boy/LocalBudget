/**
 * updateApp(アプリを最新にして再読み込みする、計画Issue #42)のユニットテスト。
 * ダウングレード検知の画面の「アプリを更新する」から呼ぶ。Service Workerの更新を確認し、
 * 待機中の新しいService Workerがあれば有効化(SKIP_WAITING)して、切り替わったら再読み込みする。
 * 新しいものが無ければそのまま再読み込みする(ブラウザの古いキャッシュを使っている場合に備える)。
 * 外部依存: なし。ServiceWorkerContainer・Registrationは偽物。
 */
import { describe, expect, it, vi } from 'vitest'
import { updateApp } from './updateApp'

function createContainer(registration: unknown) {
  const listeners = new Map<string, () => void>()
  return {
    container: {
      getRegistration: vi.fn(async () => registration),
      addEventListener: vi.fn((type: string, listener: () => void) => void listeners.set(type, listener)),
    } as unknown as ServiceWorkerContainer,
    fire: (type: string) => listeners.get(type)?.(),
  }
}

describe('updateApp', () => {
  it('Service Workerが使えない環境では、そのまま再読み込みする', async () => {
    const reload = vi.fn()

    await updateApp({ container: undefined, reload })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('登録が無ければ、そのまま再読み込みする', async () => {
    const reload = vi.fn()
    const { container } = createContainer(undefined)

    await updateApp({ container, reload })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('待機中のService Workerがあれば、SKIP_WAITINGを送り、切り替わり(controllerchange)で再読み込みする', async () => {
    const reload = vi.fn()
    const waiting = { postMessage: vi.fn() }
    const registration = { update: vi.fn(async () => {}), waiting, installing: null }
    const { container, fire } = createContainer(registration)

    await updateApp({ container, reload })

    expect(registration.update).toHaveBeenCalled()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    fire('controllerchange')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('更新の確認に失敗しても、再読み込みする(確認できなくても画面を止めない)', async () => {
    const reload = vi.fn()
    const registration = {
      update: vi.fn(async () => {
        throw new Error('offline')
      }),
      waiting: null,
      installing: null,
    }
    const { container } = createContainer(registration)

    await updateApp({ container, reload })

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
