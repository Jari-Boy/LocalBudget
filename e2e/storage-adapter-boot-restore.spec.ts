/**
 * StorageAdapterによる起動時ロード・保存フロー(計画Issue #25)のE2Eテスト。
 * Web Worker起動時にIndexedDBStorageAdapterから既存DBを復元するフロー、および
 * DB変更が永続化される(計画Issue #58でtrailing debounce化されたため、書き込み後
 * 最大でSAVE_DEBOUNCE_MS(2秒)程度の遅延を見込んでポーリング待機する)ことを、
 * 実ブラウザ(Chromium)でページ再読み込みを挟んで検証する。Node/Vitestでは
 * 再現できないブラウザ固有の統合動作のため、Playwrightで検証する
 * (docs/architecture.md 10章)。デバウンス自体の詳細な検証は
 * e2e/storage-adapter-debounce.spec.tsで行う。
 */
import { test, expect } from '@playwright/test'

test.describe('StorageAdapterによる起動時ロード・保存フロー', () => {
  test('作成したデータがIndexedDBへ永続化され、ページ再読み込み後のWorker起動時に復元される', async ({
    page,
  }) => {
    await page.goto('/')

    const createdAccountName = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const account = await client.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      })
      return account.name
    })
    expect(createdAccountName).toBe('食費')

    // withAutoSaveの永続化はfire-and-forgetかつSAVE_DEBOUNCE_MS(2秒)のtrailing debounceを
    // 挟むため、IndexedDBへの書き込み完了を待ってから再読み込みする(デフォルトのexpect
    // タイムアウトだとデバウンス分の余裕が少ないため、timeoutを明示的に延長する)
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

    await page.reload()

    const restoredAccountName = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts[0]?.name ?? null
    })

    expect(restoredAccountName).toBe('食費')
  })

  test('IndexedDBに保存済みデータがない場合、Worker起動時は空のDBになる', async ({ page }) => {
    await page.goto('/')

    const accounts = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      return client.account.findAll()
    })

    expect(accounts).toEqual([])
  })
})
