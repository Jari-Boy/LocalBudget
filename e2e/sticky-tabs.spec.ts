/**
 * 各画面のタブ・絞り込み欄の上部固定(計画Issue #266)のE2Eテスト。縦に長い画面をスクロールしても、
 * マスタの領域タブ・割勘の「割勘/精算」タブと絞り込み欄・分析のタブが、画面の上部に見え続けることを実ブラウザ(Chromium)で検証する。
 * 画面タイトルは固定しない。CSS(position: sticky)の効き方はjsdomで再現できないため、Playwrightで検証する。
 * 画面の縦の長さはデータ量に依存しないよう、メイン領域の末尾に高さのある要素を足して作る。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 720 })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
}

/**
 * 画面の内容を縦に長くして、いちばん下までスクロールする。固定要素はそれを囲む要素の外へは出られないため、
 * 実際の内容が増えたときと同じになるよう、囲む要素(画面のルート)の中に足す
 */
async function makeTallAndScroll(page: Page, containerSelector: string) {
  await page.evaluate((selector) => {
    const filler = document.createElement('div')
    filler.style.height = '3000px'
    filler.style.flex = 'none'
    document.querySelector(selector)?.appendChild(filler)
  }, containerSelector)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
}

test.describe('各画面のタブ・絞り込み欄の上部固定', () => {
  test('マスタ: 領域のタブ(科目・取引先…)が、スクロールしても画面の上部に見え続ける。タイトルは固定されない', async ({ page }) => {
    await open(page)
    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'マスタ', level: 1 })).toBeVisible()

    await makeTallAndScroll(page, '.app-shell__main')

    const tabs = page.getByRole('navigation', { name: '領域内のタブ' })
    await expect(tabs).toBeInViewport({ ratio: 1 })
    expect((await tabs.boundingBox())!.y).toBeLessThan(8)
    await expect(page.getByRole('heading', { name: 'マスタ', level: 1 })).not.toBeInViewport()
  })

  test('割勘: 「割勘/精算」のタブが固定され、絞り込み欄を開くと、絞り込み欄はタブの下に固定される', async ({ page }) => {
    await open(page)
    await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: '割勘・精算' }).click()
    await expect(page.getByRole('tab', { name: '割勘' })).toBeVisible()
    await page.getByRole('button', { name: '絞り込みを開く' }).click()
    await expect(page.getByRole('search', { name: '仕訳の絞り込み' })).toBeVisible()

    await makeTallAndScroll(page, '.split-settle')

    const tabs = page.getByRole('tablist', { name: '割勘と精算' })
    const filter = page.getByRole('search', { name: '仕訳の絞り込み' })
    await expect(tabs).toBeInViewport({ ratio: 1 })
    await expect(filter).toBeInViewport({ ratio: 1 })
    const tabsBox = (await tabs.boundingBox())!
    const filterBox = (await filter.boundingBox())!
    expect(tabsBox.y).toBeLessThan(8)
    expect(filterBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1)
  })

  test('分析: 「財務諸表/グラフ/予算」などのタブが、スクロールしても画面の上部に見え続ける', async ({ page }) => {
    await open(page)
    await page.getByRole('link', { name: '分析', exact: true }).click()
    await expect(page.getByRole('tablist', { name: '分析の種類' })).toBeVisible()

    await makeTallAndScroll(page, '.analysis')

    const tabs = page.getByRole('tablist', { name: '分析の種類' })
    await expect(tabs).toBeInViewport({ ratio: 1 })
    expect((await tabs.boundingBox())!.y).toBeLessThan(8)
  })
})
