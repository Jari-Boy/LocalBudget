/**
 * requestStoragePersistence()・getStorageEstimate()(計画Issue #27)のE2Eテスト。
 * navigator.storageはNode/jsdom環境に実装がなく、Vitestでは呼び出しロジックの
 * モック化に留めていたため、実際の値が実ブラウザ(Chromium)から取得できることを
 * Playwrightで検証する(docs/architecture.md 10章)。
 *
 * navigator.storage.persist()の許可/拒否はブラウザのヒューリスティック(サイト
 * エンゲージメントスコア等)に依存し、テスト環境で意図的に「拒否」を再現するのは
 * 困難なため、拒否時の分岐はVitestのモックテストで検証済みとし、ここでは戻り値の
 * 型(boolean)が取得できることのみを確認する。同様にestimate()のquotaは実行環境の
 * ディスク容量に依存し変動するため、具体的な数値ではなく型・取得可能性を確認する。
 */
import { test, expect } from '@playwright/test'

test.describe('ストレージ永続化リクエスト・クォータ取得', () => {
  test('requestStoragePersistence()が実ブラウザでboolean型の結果を返す', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { requestStoragePersistence } = await import(
        '/src/infrastructure/storage/requestStoragePersistence.ts'
      )
      return requestStoragePersistence()
    })

    expect(typeof result).toBe('boolean')
  })

  test('getStorageEstimate()が実ブラウザでusage/quotaの数値を返す', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { getStorageEstimate } = await import(
        '/src/infrastructure/storage/getStorageEstimate.ts'
      )
      return getStorageEstimate()
    })

    expect(result).not.toBeNull()
    expect(typeof result?.usage).toBe('number')
    expect(typeof result?.quota).toBe('number')
    expect(result?.quota ?? 0).toBeGreaterThan(0)
  })

  test('Web Worker/RPC層(RepositoryRegistry)に依存せず、単独のモジュールとして呼び出せる', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const [{ requestStoragePersistence }, { getStorageEstimate }] = await Promise.all([
        import('/src/infrastructure/storage/requestStoragePersistence.ts'),
        import('/src/infrastructure/storage/getStorageEstimate.ts'),
      ])
      const [persisted, estimate] = await Promise.all([
        requestStoragePersistence(),
        getStorageEstimate(),
      ])
      return { persisted, estimate }
    })

    expect(typeof result.persisted).toBe('boolean')
    expect(result.estimate).not.toBeNull()
  })
})
