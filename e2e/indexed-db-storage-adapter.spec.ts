/**
 * IndexedDBStorageAdapter(計画Issue #25)のE2Eテスト。IndexedDBはNode/jsdom環境には
 * 実装がなく再現できないため、実ブラウザ(Chromium)でPlaywrightを用いて検証する
 * (docs/architecture.md 10章)。Playwrightの各testはデフォルトで新規のBrowserContext
 * (=空のIndexedDB)を使うため、テスト間の状態は分離されている。
 */
import { test, expect } from '@playwright/test'

test.describe('IndexedDBStorageAdapter', () => {
  test('save()で保存したバイト列をload()で読み出せる(往復)', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { IndexedDBStorageAdapter } = await import(
        '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
      )
      const adapter = new IndexedDBStorageAdapter()
      await adapter.save(new Uint8Array([1, 2, 3, 4, 5]))
      const loaded = await adapter.load()
      return loaded ? Array.from(loaded) : null
    })

    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  test('一度もsave()していない場合、load()はnullを返す', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { IndexedDBStorageAdapter } = await import(
        '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
      )
      const adapter = new IndexedDBStorageAdapter()
      return adapter.load()
    })

    expect(result).toBeNull()
  })

  test('save()を複数回呼ぶと最新のデータで上書きされる', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { IndexedDBStorageAdapter } = await import(
        '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
      )
      const adapter = new IndexedDBStorageAdapter()
      await adapter.save(new Uint8Array([1, 1, 1]))
      await adapter.save(new Uint8Array([9, 9]))
      const loaded = await adapter.load()
      return loaded ? Array.from(loaded) : null
    })

    expect(result).toEqual([9, 9])
  })

  test('別のIndexedDBStorageAdapterインスタンスからでも保存済みデータを読み出せる', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { IndexedDBStorageAdapter } = await import(
        '/src/infrastructure/storage/IndexedDBStorageAdapter.ts'
      )
      await new IndexedDBStorageAdapter().save(new Uint8Array([7, 8]))
      const loaded = await new IndexedDBStorageAdapter().load()
      return loaded ? Array.from(loaded) : null
    })

    expect(result).toEqual([7, 8])
  })
})
