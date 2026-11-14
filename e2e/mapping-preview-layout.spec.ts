/**
 * マスタ「明細マッピング」タブの右パネルのレイアウトを、実ブラウザ(Chromium)で検証する。
 * 右パネルは縦並びのflexで、表を囲むoverflow付きの枠(.master-table-wrap)は、高さが足りないと
 * 0近くまで縮められて「元のCSV」「取り込み結果のプレビュー」の表が線1本につぶれる(計画Issue #192の
 * 実機確認での指摘)。jsdomはレイアウトを計算しないため、コンポーネントテストでは検出できない。
 * 外部依存: 開発サーバー(組み込みのマッピング定義が投入される)。ネットワークアクセスなし。
 */
import { test, expect } from '@playwright/test'

test.describe('明細マッピングタブのプレビュー表のレイアウト', () => {
  test('CSVを選ぶと、元のCSVと取り込み結果の表がつぶれずに表示される', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await page
      .getByRole('navigation', { name: '領域内のタブ' })
      .getByRole('link', { name: '明細マッピング', exact: true })
      .click()
    await page.getByRole('button', { name: /楽天カード\(確定明細\)/ }).click()

    const csv =
      '利用日,利用店名・商品名,利用金額\n2026/10/05,コンビニ,-300\n2026/10/11,給与,250000\n2026/10/12,A,100\n2026/10/13,B,200\n'
    await page
      .getByLabel('プレビュー用のCSV')
      .setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByText(/全4行を読み取れます/)).toBeVisible()

    const wraps = page.locator('.master-table-wrap')
    await expect(wraps).toHaveCount(2)
    for (const index of [0, 1]) {
      const box = await wraps.nth(index).boundingBox()
      // 表の行(ヘッダー+4行)が見える高さがある。つぶれると2px程度になる
      expect(box?.height ?? 0).toBeGreaterThan(100)
    }
  })
})
