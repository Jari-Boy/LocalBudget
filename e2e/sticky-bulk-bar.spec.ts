/**
 * 上部固定のタブ・絞り込み欄・一括編集バーと、表の見出しの固定(計画Issue #266)のE2Eテスト。
 * 仕訳一覧の「明細行単位」の表で、(1)バーが出ても消えても、選んだ行の画面上の位置が動かないこと、
 * (2)ページをスクロールすると、タブの行と一括編集バー、表の見出しが画面の上部に見え続け、互いに重ならないこと
 * (見出しは、横スクロール用の枠の外に置いた複製を固定する)、(3)表を横にスクロールしても、固定した見出しの列が
 * 本物の行の列とずれないこと、(4)確認のダイアログが固定領域の上に出ることを、実ブラウザ(Chromium)で検証する。
 * CSS(position: sticky)とスクロール位置の補正はjsdomで再現できないため、Playwrightで検証する。
 * 縦に長い一覧は、仕訳を40件作って用意する。事前データ準備はpage.evaluate内の別Workerで行い、flush()してからreloadする。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

const VIEW_KEY = 'localbudget:journal-view-mode'

/** 仕訳を40件作り、明細行単位の表示で仕訳一覧を開く。width を狭くすると、表が横にはみ出して横スクロールになる */
async function openLineView(page: Page, width = 1400) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
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
  await page.evaluate((key) => localStorage.setItem(key, 'line'), VIEW_KEY)
  await page.reload()
  await page.getByRole('link', { name: '仕訳', exact: true }).click()
  await expect(page.getByRole('table', { name: '仕訳の明細行' })).toBeVisible()
}

const debitBoxes = (page: Page) => page.getByRole('checkbox', { name: '借方の行を選択' })
const bulkBar = (page: Page) => page.getByRole('region', { name: '一括編集' })
const tabList = (page: Page) => page.getByRole('tablist', { name: '仕訳の種類' })
/** 表の横スクロールの枠 */
const tableRegion = (page: Page) => page.locator('.journal-line-table')
/** ページのスクロールで固定される、見出しの複製(固定中だけ見える) */
const floatingHeader = (page: Page) => page.locator('.floating-table-header')

async function boxOf(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

test.describe('上部固定の一括編集バーとタブ、表の見出し(明細行単位)', () => {
  test('最初のチェックを付けてバーが出ても、選んだ行の画面上の位置は動かない。解除したときも動かない', async ({ page }) => {
    await openLineView(page)
    await page.evaluate(() => window.scrollTo(0, 400))
    const target = debitBoxes(page).nth(8)
    await target.scrollIntoViewIfNeeded()
    const before = await boxOf(target)

    await target.check()
    await expect(bulkBar(page)).toBeVisible()
    expect(Math.abs((await boxOf(target)).y - before.y)).toBeLessThan(1.5)

    await bulkBar(page).getByRole('button', { name: '選択を解除' }).click()
    await expect(bulkBar(page)).toHaveCount(0)
    expect(Math.abs((await boxOf(target)).y - before.y)).toBeLessThan(1.5)
  })

  test('ページの一番上でチェックを付けても、バーが出て行が動かない', async ({ page }) => {
    await openLineView(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    const target = debitBoxes(page).nth(2)
    await target.scrollIntoViewIfNeeded()
    const before = await boxOf(target)

    await target.check()
    await expect(bulkBar(page)).toBeVisible()

    expect(Math.abs((await boxOf(target)).y - before.y)).toBeLessThan(1.5)
  })

  test('ページをスクロールすると、表の見出し(複製)が画面の上部に固定され、固定したタブの行に覆われない。表の先頭に戻ると消える', async ({ page }) => {
    await openLineView(page)
    // 表の先頭にいる間は、複製は見せない
    await expect(floatingHeader(page)).toHaveAttribute('data-stuck', 'false')

    await page.evaluate(() => window.scrollTo(0, 900))

    await expect(floatingHeader(page)).toHaveAttribute('data-stuck', 'true')
    const header = floatingHeader(page).getByRole('columnheader', { name: '日付' })
    await expect(header).toBeInViewport({ ratio: 1 })
    const tabs = await boxOf(tabList(page))
    const headerBox = await boxOf(header)
    // 見出しはタブの行の下にあり、タブの行や他の要素に覆われず一番手前に見えている
    expect(headerBox.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
    const visible = await header.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    })
    expect(visible).toBe(true)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(floatingHeader(page)).toHaveAttribute('data-stuck', 'false')
  })

  test('スクロールしても、タブの行・一括編集バー・表の見出しが上から順に並んで見え続け、重ならない', async ({ page }) => {
    await openLineView(page)
    await debitBoxes(page).nth(2).check()
    await expect(bulkBar(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, 900))

    await expect(floatingHeader(page)).toHaveAttribute('data-stuck', 'true')
    await expect(tabList(page)).toBeInViewport({ ratio: 1 })
    await expect(bulkBar(page)).toBeInViewport({ ratio: 1 })
    const tabs = await boxOf(tabList(page))
    const bar = await boxOf(bulkBar(page))
    const header = await boxOf(floatingHeader(page).getByRole('columnheader', { name: '日付' }))
    expect(tabs.y).toBeLessThan(8)
    expect(bar.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
    expect(header.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
  })

  test('絞り込み欄を開くと、バーと表の見出しは絞り込み欄の下に並び、重ならない', async ({ page }) => {
    await openLineView(page)
    await page.getByRole('button', { name: '絞り込みを開く' }).click()
    await debitBoxes(page).nth(2).check()
    await expect(bulkBar(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, 1100))

    const filter = await boxOf(page.getByRole('search', { name: '仕訳の絞り込み' }))
    const bar = await boxOf(bulkBar(page))
    const header = await boxOf(floatingHeader(page).getByRole('columnheader', { name: '日付' }))
    await expect(page.getByRole('search', { name: '仕訳の絞り込み' })).toBeInViewport({ ratio: 1 })
    expect(bar.y).toBeGreaterThanOrEqual(filter.y + filter.height - 1)
    expect(header.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
  })

  test('表を横にスクロールしても、固定した見出しの列は、本物の行の列とずれない', async ({ page }) => {
    // 幅を狭くして、表が横にはみ出す(横スクロールになる)ようにする
    await openLineView(page, 1100)
    expect(await tableRegion(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 900))
    await expect(floatingHeader(page)).toHaveAttribute('data-stuck', 'true')

    await tableRegion(page).evaluate((el) => {
      el.scrollLeft = 260
    })

    // 見出しの「日付」の列の左端と、その列の本物のセルの左端が、横にずれていない(0px・1px以内)。複製は表の枠の中にある
    const headerLeft = (await boxOf(floatingHeader(page).getByRole('columnheader', { name: '日付' }))).x
    const cellLeft = (await boxOf(page.getByRole('table', { name: '仕訳の明細行' }).locator('tbody tr td').first())).x
    expect(Math.abs(headerLeft - cellLeft)).toBeLessThan(1.5)
    // 見出しの「科目」(借方の1つめ)も、本物の科目のセルとずれない
    const accountHeader = floatingHeader(page).getByRole('columnheader', { name: /^科目/ }).first()
    const accountCell = page.getByRole('table', { name: '仕訳の明細行' }).locator('tbody tr').first().getByRole('cell').nth(5)
    expect(Math.abs((await boxOf(accountHeader)).x - (await boxOf(accountCell)).x)).toBeLessThan(1.5)
  })

  test('「適用」の確認ダイアログは、固定されたタブの行より手前に出て、画面全体を覆う', async ({ page }) => {
    await openLineView(page)
    await debitBoxes(page).nth(2).check()
    await bulkBar(page).getByRole('button', { name: '一括編集の科目: 変更しない' }).click()
    await page.getByRole('dialog', { name: '一括編集の科目' }).getByRole('button', { name: 'ランチ代', exact: true }).click()
    await bulkBar(page).getByRole('button', { name: /行に適用$/ }).click()

    const dialog = page.getByRole('dialog', { name: '一括編集の確認' })
    await expect(dialog).toBeVisible()
    // ダイアログの中心にある要素が、ダイアログ自身(固定されたタブの行ではない)であること
    const top = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return el.contains(hit)
    })
    expect(top).toBe(true)
    // 背景(バックドロップ)は画面の上端にも及び、固定されたタブの行を覆う
    const coversTabs = await page.evaluate(() => {
      const hit = document.elementFromPoint(window.innerWidth / 2, 4)
      return hit?.closest('.confirm-dialog__backdrop') !== null
    })
    expect(coversTabs).toBe(true)
  })

  test('画面タイトルは固定されず、スクロールすると見えなくなる', async ({ page }) => {
    await openLineView(page)

    await page.evaluate(() => window.scrollTo(0, 900))

    await expect(page.getByRole('heading', { name: '仕訳', level: 1 })).not.toBeInViewport()
  })
})
