/**
 * 更新確認バナー(UpdateBanner)とiOS誘導ポップアップ(IosInstallPrompt)が
 * 同時に表示されうる場合の重なり順を検証するE2Eテスト。
 * どちらもposition: fixedの独立コンポーネントであり、iOS Safariで新しい
 * Service Workerを検出した際は両方が同時に表示条件を満たす。
 * aria-modal="true"のIosInstallPromptを常に最前面にする設計(計画Issue #28
 * Implementation Attempt 1のevaluatorレビュー指摘への対応)を検証する。
 */
import { test, expect, devices, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const swPath = resolve(import.meta.dirname, '../dist/sw.js')
const iPhoneUserAgent = devices['iPhone 13'].userAgent

async function waitForServiceWorkerController(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), {
    timeout: 30_000,
  })
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
    timeout: 30_000,
  })
}

test.describe('更新確認バナーとiOS誘導ポップアップの重なり順', () => {
  test.use({ userAgent: iPhoneUserAgent })

  test('両方が表示された状態で、iOS誘導ポップアップのモーダルが更新確認バナーより前面に表示される', async ({
    page,
  }) => {
    await waitForServiceWorkerController(page)

    const overlay = page.locator('.ios-install-prompt-overlay')
    await expect(overlay).toBeVisible()

    const original = readFileSync(swPath, 'utf-8')
    try {
      writeFileSync(swPath, `${original}\n// e2e-${Date.now()}`)
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
      })

      const banner = page.locator('.update-banner')
      await expect(banner).toBeVisible({ timeout: 30_000 })

      // DOM順(IosInstallPromptがApp.tsx内でUpdateBannerより後に配置されている)に
      // 依存すると、たまたま重なり順が正しく見えるだけでz-indexの実装漏れを
      // 検出できない。computed z-indexの数値そのものを比較することで、
      // 「モーダルは常に前面に来る」設計が保たれていることを検証する。
      const [overlayZIndex, bannerZIndex] = await Promise.all([
        overlay.evaluate((el) => Number(getComputedStyle(el).zIndex)),
        banner.evaluate((el) => Number(getComputedStyle(el).zIndex)),
      ])
      expect(overlayZIndex).toBeGreaterThan(bannerZIndex)
    } finally {
      writeFileSync(swPath, original)
    }
  })
})
