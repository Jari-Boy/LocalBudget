/**
 * flushOnPageHide のユニットテスト。ページが非表示になった時(documentのvisibilitychangeで
 * visibilityStateがhiddenになった時)、および実際にアンロードされる時(windowのpagehide)に、
 * 渡された永続化ハンドルのflush()をデバウンスタイマーを待たず呼び出すことを検証する
 * (計画Issue #58、docs/architecture.md 4.2節「ページ非表示時」の実現箇所)。実際の
 * document/windowではなくEventTarget実装のスタブを注入することで、Node/Vitest上で検証する
 * (waitForWorkerReadyと同様、EventTargetの標準APIのみに依存させる設計)。
 * 外部依存なし。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushOnPageHide } from './flushOnPageHide'

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

function createRecordingPersistence(): { flushCallCount: number; flush: () => Promise<void> } {
  let flushCallCount = 0
  return {
    get flushCallCount() {
      return flushCallCount
    },
    async flush() {
      flushCallCount += 1
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('flushOnPageHide', () => {
  it('documentのvisibilitychangeでvisibilityStateがhiddenになった時、flush()を呼ぶ', () => {
    const doc = new FakeDocument()
    const win = new EventTarget()
    const persistence = createRecordingPersistence()
    flushOnPageHide(persistence, doc, win)

    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))

    expect(persistence.flushCallCount).toBe(1)
  })

  it('visibilitychangeでvisibilityStateがvisibleのままの場合はflush()を呼ばない', () => {
    const doc = new FakeDocument()
    const win = new EventTarget()
    const persistence = createRecordingPersistence()
    flushOnPageHide(persistence, doc, win)

    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))

    expect(persistence.flushCallCount).toBe(0)
  })

  it('windowのpagehideイベントでflush()を呼ぶ', () => {
    const doc = new FakeDocument()
    const win = new EventTarget()
    const persistence = createRecordingPersistence()
    flushOnPageHide(persistence, doc, win)

    win.dispatchEvent(new Event('pagehide'))

    expect(persistence.flushCallCount).toBe(1)
  })

  it('flush()が失敗してもunhandled rejectionにならず、console.errorでログに残る', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    const doc = new FakeDocument()
    const win = new EventTarget()
    const error = new Error('flush failed')
    const persistence = {
      flush: async () => {
        throw error
      },
    }
    flushOnPageHide(persistence, doc, win)

    win.dispatchEvent(new Event('pagehide'))
    await flushMicrotasks()

    process.off('unhandledRejection', onUnhandledRejection)
    expect(unhandledRejections).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), error)
    consoleErrorSpy.mockRestore()
  })
})
