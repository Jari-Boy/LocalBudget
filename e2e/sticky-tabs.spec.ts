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

    const tabs = page.getByRole('tablist', { name: '割勘・精算・履歴' })
    const filter = page.getByRole('search', { name: '仕訳の絞り込み' })
    await expect(tabs).toBeInViewport({ ratio: 1 })
    await expect(filter).toBeInViewport({ ratio: 1 })
    const tabsBox = (await tabs.boundingBox())!
    const filterBox = (await filter.boundingBox())!
    expect(tabsBox.y).toBeLessThan(8)
    expect(filterBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1)
  })

  /**
   * 右の詳細パネルは、固定したタブの行の下に追従する(タブの行に覆われて見切れない)。
   * パネルは画面の上端から固定ヘッダーの高さの分だけ下がり、パネルが画面より縦に長いときはパネルの中だけがスクロールする。
   */
  test('マスタ: 右の編集パネルは、固定したタブの行に覆われず、その下に追従する', async ({ page }) => {
    await open(page)
    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await page.getByRole('button', { name: '食費', exact: true }).click()
    const panel = page.locator('.master-split > .master-panel')
    await expect(panel).toBeVisible()

    await makeTallAndScroll(page, '.master-split__main')

    const tabs = (await page.getByRole('navigation', { name: '領域内のタブ' }).boundingBox())!
    const box = (await panel.boundingBox())!
    await expect(panel).toBeInViewport({ ratio: 1 })
    expect(box.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(721)
  })

  test('仕訳一覧: 右の詳細パネルは、固定したタブの行に覆われず、その下に追従する', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const expense = await client.account.create({ category: 'expense', name: 'ランチ代', isReconcilable: null })
      const cash = await client.account.create({ category: 'asset', name: '現金', isReconcilable: false })
      const [member] = await client.householdMember.findAll()
      for (let i = 1; i <= 40; i += 1) {
        await client.journalEntry.create({
          entryDate: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
          memo: `明細${String(i).padStart(2, '0')}`,
          householdMemberId: member.id,
          lines: [
            { householdMemberId: member.id, accountId: expense.id, side: 'debit', amount: 100 + i },
            { householdMemberId: member.id, accountId: cash.id, side: 'credit', amount: 100 + i },
          ],
        })
      }
      await client.autoSave.flush()
    })
    await page.reload()
    await page.getByRole('link', { name: '仕訳', exact: true }).click()
    const panel = page.getByRole('region', { name: '仕訳の詳細' })
    await expect(panel).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const tabs = (await page.getByRole('tablist', { name: '仕訳の種類' }).boundingBox())!
    await expect(panel).toBeInViewport({ ratio: 1 })
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
  })
  /**
   * 表の見出しも、ページのスクロールで画面の上部に固定される(横スクロール用の枠の外に置いた見出しの複製を固定する)。
   * 固定した見出しは、タブの行(・絞り込み欄)の下にあり、他の要素に覆われず一番手前に見える。
   */
  async function expectHeaderStuckBelow(page: Page, header: ReturnType<Page['locator']>, above: ReturnType<Page['locator']>) {
    await expect(header).toBeInViewport({ ratio: 1 })
    const aboveBox = (await above.boundingBox())!
    const headerBox = (await header.boundingBox())!
    expect(headerBox.y).toBeGreaterThanOrEqual(aboveBox.y + aboveBox.height - 1)
    const visible = await header.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    })
    expect(visible).toBe(true)
  }

  test('マスタ(科目): 検索・追加の行と表の見出しが、スクロールしても、固定したタブの行の下に順に固定される。列は行とずれない', async ({ page }) => {
    await open(page)
    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await expect(page.getByRole('button', { name: '食費', exact: true })).toBeVisible()
    const floating = page.locator('.floating-table-header')
    await expect(floating).toHaveAttribute('data-stuck', 'false')

    await page.evaluate(() => window.scrollTo(0, 500))

    await expect(floating).toHaveAttribute('data-stuck', 'true')
    const header = floating.getByRole('columnheader').nth(1)
    // 検索・追加ボタンの行も、タブの行の下に固定される。表の見出しは、その行の下に固定される
    const toolbar = page.locator('.master-split__main > .sticky-toolbar')
    await expectHeaderStuckBelow(page, toolbar, page.getByRole('navigation', { name: '領域内のタブ' }))
    await expect(toolbar.getByRole('textbox')).toBeInViewport({ ratio: 1 })
    await expectHeaderStuckBelow(page, header, toolbar)
    // 見出しの列は、本物の行の列とずれない(名称の列。最初の行は区分の見出し行のことがあるため、通常の行を使う)
    const firstRowName = page.locator('.tree-table__table tbody tr.tree-table__row').first().getByRole('cell').nth(1)
    expect(Math.abs((await header.boundingBox())!.x - (await firstRowName.boundingBox())!.x)).toBeLessThan(1.5)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(floating).toHaveAttribute('data-stuck', 'false')
  })

  test('マスタ(世帯メンバー): 追加ボタンと検索欄の行が、スクロールしても、固定したタブの行の下に固定される', async ({ page }) => {
    await open(page)
    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await page.getByRole('navigation', { name: '領域内のタブ' }).getByRole('link', { name: '世帯メンバー' }).click()
    const toolbar = page.locator('.master-split__main > .sticky-toolbar')
    await expect(toolbar).toBeVisible()
    await makeTallAndScroll(page, '.master-split__main')

    await expectHeaderStuckBelow(page, toolbar, page.getByRole('navigation', { name: '領域内のタブ' }))
    await expect(toolbar.getByRole('textbox')).toBeInViewport({ ratio: 1 })
    await expect(toolbar.getByRole('button').first()).toBeInViewport({ ratio: 1 })
  })
  test('割勘: 「割勘する行」の表の見出しが固定される。絞り込み欄を開くと、その下に固定される', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const expense = await client.account.create({ category: 'expense', name: '割勘用食費', isReconcilable: null })
      const cash = await client.account.create({ category: 'asset', name: '割勘用現金', isReconcilable: false })
      const [member] = await client.householdMember.findAll()
      for (let i = 1; i <= 40; i += 1) {
        await client.journalEntry.create({
          entryDate: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
          memo: `割勘候補${String(i).padStart(2, '0')}`,
          householdMemberId: member.id,
          lines: [
            { householdMemberId: member.id, accountId: expense.id, side: 'debit', amount: 100 + i },
            { householdMemberId: member.id, accountId: cash.id, side: 'credit', amount: 100 + i },
          ],
        })
      }
      await client.autoSave.flush()
    })
    await page.reload()
    await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: '割勘・精算' }).click()
    await expect(page.getByRole('region', { name: '割勘する行' })).toBeVisible()
    const floating = page.getByRole('region', { name: '割勘する行' }).locator('.floating-table-header')
    await expect(floating).toHaveAttribute('data-stuck', 'false')

    await page.evaluate(() => window.scrollTo(0, 700))

    await expect(floating).toHaveAttribute('data-stuck', 'true')
    const header = floating.getByRole('columnheader', { name: '日付' })
    const tabs = page.getByRole('tablist', { name: '割勘・精算・履歴' })
    await expectHeaderStuckBelow(page, header, tabs)
    // 見出しの列は、本物の行の列とずれない(日付の列)
    const firstRowDate = page.getByRole('region', { name: '割勘する行' }).locator('tbody tr').first().getByRole('cell').nth(0)
    expect(Math.abs((await header.boundingBox())!.x - (await firstRowDate.boundingBox())!.x)).toBeLessThan(1.5)

    await page.getByRole('button', { name: '絞り込みを開く' }).click()
    await page.evaluate(() => window.scrollTo(0, 700))
    await expect(floating).toHaveAttribute('data-stuck', 'true')
    await expectHeaderStuckBelow(page, header, page.getByRole('search', { name: '仕訳の絞り込み' }))
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
