/**
 * 操作履歴・ロールバック(計画Issue #202)のE2Eテスト。
 * 実ブラウザ(Chromium)で、Web Worker内のsql.js(WASM)に張った一時トリガーによる履歴の記録と、
 * Comlink越しの呼び出し(Repositoryを包むProxy)・履歴API・操作履歴画面での取消という、
 * Node/Vitestでは再現できないブラウザ固有の統合動作を検証する。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし、Vite dev serverはlocalhost)。
 */
import { test, expect } from '@playwright/test'

test.describe('操作履歴', () => {
  test('RPC経由の書き込みがWorker内の履歴に残り、historyのAPIで取り消せる', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const before = (await client.history.list()).length
      const created = await client.counterparty.create({ name: 'E2E履歴テスト' })
      await client.counterparty.findAll()
      const afterCreate = await client.history.list()
      const preview = await client.history.previewUndoTo(afterCreate[0].id)
      await client.history.undoTo(afterCreate[0].id)
      const afterUndo = await client.history.list()
      const found = await client.counterparty.findById(created.id)
      return {
        added: afterCreate.length - before,
        label: afterCreate[0].label,
        previewCount: preview.operations.length,
        afterUndoCount: afterUndo.length - before,
        found,
        limit: await client.history.limit(),
      }
    })

    // 読み取り(findAll)は履歴に残らず、書き込み1件だけが残る
    expect(result.added).toBe(1)
    expect(result.label).toBe('counterparty.create')
    expect(result.previewCount).toBe(1)
    expect(result.afterUndoCount).toBe(0)
    expect(result.found).toBeNull()
    expect(result.limit).toBe(50)
  })

  test('サイドナビの「操作履歴」から画面を開くと、起動直後(履歴は再読み込みで消える)は0件の表示になる', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('link', { name: '操作履歴', exact: true }).click()

    await expect(page.getByRole('heading', { name: '操作履歴', level: 1 })).toBeVisible()
    await expect(page.getByText('戻せる操作はまだありません')).toBeVisible()
    await expect(page.getByText(/履歴 0 \/ 50件/)).toBeVisible()
  })
})
