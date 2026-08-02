/**
 * withAutoSaveのtrailing debounce(計画Issue #58)のE2Eテスト。DB書き込みの永続化が
 * 即時ではなくSAVE_DEBOUNCE_MS(2秒)後にまとめて行われること、およびページ非表示相当の
 * イベント(visibilitychange/pagehide)発生時にはデバウンスタイマーを待たず確実に
 * 保存されることを、実ブラウザ(Chromium)で検証する。Node/Vitestでは再現できない
 * ブラウザ固有の統合動作のため、Playwrightで検証する(docs/architecture.md 10章)。
 */
import { test, expect } from '@playwright/test'

test.describe('withAutoSaveのデバウンス', () => {
  test('書き込み直後はまだIndexedDBへ保存されておらず、デバウンス時間経過後にまとめて保存される', async ({
    page,
  }) => {
    await page.goto('/')

    const immediatelyAfterWrite = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const { IndexedDBStorageAdapter } = await import(
        '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
      )
      const client = await createDbClient()

      await client.account.create({ category: 'expense', name: '食費', isReconcilable: null })
      await client.account.create({ category: 'expense', name: '交通費', isReconcilable: null })

      return new IndexedDBStorageAdapter().load()
    })
    expect(immediatelyAfterWrite).toBeNull()

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { IndexedDBStorageAdapter } = await import(
              '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
            )
            const data = await new IndexedDBStorageAdapter().load()
            return data !== null && data.length > 0
          }),
        { timeout: 10000 },
      )
      .toBe(true)

    const accountNames = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.map((a) => a.name).sort()
    })
    expect(accountNames).toEqual(['交通費', '食費'])
  })

  test('documentのvisibilitychangeでhiddenになると、デバウンス時間を待たずflush()経由で保存される', async ({
    page,
  }) => {
    await page.goto('/')

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      await client.account.create({ category: 'expense', name: '食費', isReconcilable: null })

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // SAVE_DEBOUNCE_MS(2秒)より十分短いタイムアウトで保存完了を待つことで、
    // デバウンスタイマーを待たずflush()経由で保存されたことを検証する。
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { IndexedDBStorageAdapter } = await import(
              '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
            )
            const data = await new IndexedDBStorageAdapter().load()
            return data !== null && data.length > 0
          }),
        { timeout: 1500 },
      )
      .toBe(true)
  })

  test('windowのpagehideイベントでも、デバウンス時間を待たずflush()経由で保存される', async ({
    page,
  }) => {
    await page.goto('/')

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      await client.account.create({ category: 'expense', name: '食費', isReconcilable: null })

      window.dispatchEvent(new Event('pagehide'))
    })

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { IndexedDBStorageAdapter } = await import(
              '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
            )
            const data = await new IndexedDBStorageAdapter().load()
            return data !== null && data.length > 0
          }),
        { timeout: 1500 },
      )
      .toBe(true)
  })
})
