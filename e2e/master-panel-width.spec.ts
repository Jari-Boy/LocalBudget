/**
 * マスタ画面の右の詳細パネルの幅を、実ブラウザ(Chromium)で検証する。
 * マスタの各タブ(勘定科目・取引先・世帯メンバー・プロジェクト・明細マッピング)は
 * 共通のクラス(.master-split)で一覧と右パネルを横に並べる。右パネルは画面の半分くらいの幅に
 * 広げる(実機確認での指摘)。jsdomはレイアウトを計算しないため、コンポーネントテストでは検出できない。
 * ここでは共通のクラスを使う代表として明細マッピングタブで確かめる。
 * 外部依存: 開発サーバー(組み込みのマッピング定義が投入される)。ネットワークアクセスなし。
 */
import { test, expect } from '@playwright/test'

test.describe('マスタの右パネルの幅', () => {
  test('一覧と右パネルを横に並べたとき、右パネルが全体の半分くらいの幅になる', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await page
      .getByRole('navigation', { name: '領域内のタブ' })
      .getByRole('link', { name: '明細マッピング', exact: true })
      .click()
    await page.getByRole('button', { name: /楽天カード\(確定明細\)/ }).click()

    const main = await page.locator('.master-split__main').boundingBox()
    const panel = await page.locator('.master-split > .master-panel').boundingBox()
    expect(main).not.toBeNull()
    expect(panel).not.toBeNull()
    const ratio = panel!.width / (main!.width + panel!.width)
    // 画面(一覧+右パネル)の45〜55%
    expect(ratio).toBeGreaterThan(0.45)
    expect(ratio).toBeLessThan(0.55)
  })
})
