/**
 * 右パネルの追従(計画Issue #194)のE2Eテスト。左の一覧が縦に長くなってページをスクロールしても、
 * 右に開いた詳細パネル(マスタの編集パネル・複数選択時の一括操作パネル)が画面内に追従し、
 * パネルが画面より縦に長いときはパネルの中だけがスクロールすることを実ブラウザ(Chromium)で検証する。
 * CSS(position: sticky)の効き方はjsdomで再現できないため、Playwrightで検証する。
 * 一覧の縦の長さはデータ量に依存しないよう、一覧の囲み要素に高さのある要素を足して作る。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

async function openAccountsTab(page: Page) {
  await page.setViewportSize({ width: 1400, height: 720 })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  await page.getByRole('link', { name: 'マスタ', exact: true }).click()
  await expect(page.getByRole('button', { name: '食費', exact: true })).toBeVisible()
}

async function makeListTall(page: Page) {
  await page.evaluate(() => {
    const filler = document.createElement('div')
    filler.style.height = '3000px'
    document.querySelector('.master-split__main')?.appendChild(filler)
  })
}

test.describe('右パネルの追従', () => {
  test('マスタで科目を開いたあと一覧を下までスクロールしても、右の編集パネルが画面内に見える', async ({ page }) => {
    await openAccountsTab(page)
    await page.getByRole('button', { name: '食費', exact: true }).click()
    const panel = page.locator('.master-split > .master-panel')
    await expect(panel).toBeVisible()
    await makeListTall(page)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    await expect(panel).toBeInViewport({ ratio: 1 })
  })

  test('2件以上チェックしたときの右の一括操作パネルも、一覧を下までスクロールしても画面内に見える', async ({ page }) => {
    await openAccountsTab(page)
    await page.getByRole('checkbox', { name: '食費を選択' }).check()
    await page.getByRole('checkbox', { name: '交通費を選択' }).check()
    const panel = page.getByRole('region', { name: '一括操作' })
    await expect(panel).toBeVisible()
    await makeListTall(page)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    await expect(panel).toBeInViewport({ ratio: 1 })
  })

  test('パネルが画面の高さより縦に長いときは、パネルの中だけがスクロールする', async ({ page }) => {
    await openAccountsTab(page)
    await page.getByRole('button', { name: '食費', exact: true }).click()
    const panel = page.locator('.master-split > .master-panel')
    await expect(panel).toBeVisible()
    await makeListTall(page)
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = '2000px'
      filler.style.flex = 'none'
      document.querySelector('.master-split > .master-panel')?.appendChild(filler)
    })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeLessThanOrEqual(720)
    const scrollable = await panel.evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(scrollable).toBe(true)
  })

  test('幅が狭くパネルが一覧の下に折り返す画面では、追従せず通常の縦積みのまま', async ({ page }) => {
    await openAccountsTab(page)
    await page.setViewportSize({ width: 700, height: 720 })
    await page.getByRole('button', { name: '食費', exact: true }).click()
    const panel = page.locator('.master-split > .master-panel')
    await expect(panel).toBeVisible()

    const position = await panel.evaluate((el) => getComputedStyle(el).position)

    expect(position).toBe('static')
  })
})
