/**
 * vite-plugin-pwa(generateSW戦略)によるアプリシェル(HTML/CSS/JS/アイコン)precacheを
 * 検証するE2Eテスト。docs/architecture.md 7章・10章の方針に基づき、Service Workerの
 * 挙動は実ブラウザ(Chromium/Playwright)で検証する。ビルド済み成果物をpreviewサーバーで
 * 配信するplaywright.pwa.config.ts経由で実行する。
 */
import { test, expect } from '@playwright/test'

test.describe('オフライン起動(Service Workerによるアプリシェルprecache)', () => {
  test('Service Workerがアクティブ化された状態でオフラインに切り替えても再読み込みでアプリシェルが表示される', async ({
    page,
    context,
  }) => {
    await page.goto('/')

    // 初回訪問時はService Workerの登録・アクティブ化は行われるが、
    // (workboxのclientsClaimが既定でfalseのため)そのページ自体はまだ制御下に
    // 入らない。activate完了(serviceWorker.ready)を待ってから再読み込みし、
    // 次のナビゲーションでcontrollerが設定されるようにする。
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), {
      timeout: 30_000,
    })
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
      timeout: 30_000,
    })

    await context.setOffline(true)
    const response = await page.reload()

    expect(response).not.toBeNull()
    expect(response?.ok()).toBe(true)
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page).toHaveTitle('LocalBudget')

    await context.setOffline(false)
  })
})
