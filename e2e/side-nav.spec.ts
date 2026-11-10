/**
 * サイドナビの配置(計画Issue #173)のE2Eテスト。サイドナビの一番下に置いた「設定」が、仕訳一覧のように
 * 縦に長い画面でも見切れず、ページをスクロールしても常に画面内に見えることを実ブラウザ(Chromium)で
 * 検証する。CSSによる配置(position: sticky)はjsdomで再現できないため、Playwrightで検証する。
 * ページの縦の長さはデータ量に依存しないよう、main内に高さのある要素を足して作る。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect } from '@playwright/test'

test.describe('サイドナビ', () => {
  test('幅の広い画面では、縦に長いページの上端でも下端でも「設定」が画面内に見える', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await expect(nav).toBeVisible()

    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = '3000px'
      document.querySelector('main')?.appendChild(filler)
    })

    const settings = nav.getByRole('link', { name: '設定', exact: true })
    await expect(settings).toBeInViewport()

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(settings).toBeInViewport()
    await expect(nav.getByRole('link', { name: '仕訳', exact: true })).toBeInViewport()
  })
})
