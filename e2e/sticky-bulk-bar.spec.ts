/**
 * 上部固定のタブ・絞り込み欄・一括編集バーと、表の見出しの固定(計画Issue #266)のE2Eテスト。
 * 仕訳一覧の「明細行単位」の表で、(1)バーが出ても消えても、選んだ行の画面上の位置が動かないこと(表の枠の中・ページの
 * 一番上のどちらでも)、(2)表が画面の高さに収まる枠で、枠の中でスクロールしても見出しが枠の上端に固定されること、
 * (3)タブの行と一括編集バーが画面の上部に見え続け、バーがタブの行・絞り込み欄に重ならないこと、
 * (4)確認のダイアログが固定領域の上に出ることを、実ブラウザ(Chromium)で検証する。
 * CSS(position: sticky・枠の高さ)とスクロール位置の相殺はjsdomで再現できないため、Playwrightで検証する。
 * 縦に長い一覧は、仕訳を40件作って用意する。事前データ準備はpage.evaluate内の別Workerで行い、flush()してからreloadする。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

const VIEW_KEY = 'localbudget:journal-view-mode'
const VIEWPORT_HEIGHT = 720

/** 仕訳を40件作り、明細行単位の表示で仕訳一覧を開く */
async function openLineView(page: Page) {
  await page.setViewportSize({ width: 1400, height: VIEWPORT_HEIGHT })
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
/** 表のスクロールの枠(画面の高さに収まり、枠の中で縦横にスクロールする) */
const tableRegion = (page: Page) => page.locator('.journal-line-table')

/** 要素の中心が、ほかの要素(固定したタブの行など)に覆われておらず、その要素自身が一番手前に見えていること */
async function expectNotCovered(locator: ReturnType<Page['locator']>) {
  const visible = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return el.contains(hit)
  })
  expect(visible).toBe(true)
}

async function boxOf(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

test.describe('上部固定の一括編集バーとタブ、表の見出し(明細行単位)', () => {
  test('表の枠を途中までスクロールした状態で最初のチェックを付けても、選んだ行の画面上の位置は動かない', async ({ page }) => {
    await openLineView(page)
    await tableRegion(page).evaluate((el) => {
      el.scrollTop = 300
    })
    const target = debitBoxes(page).nth(8)
    await target.scrollIntoViewIfNeeded()
    const before = await boxOf(target)

    await target.check()
    await expect(bulkBar(page)).toBeVisible()

    expect(Math.abs((await boxOf(target)).y - before.y)).toBeLessThan(1.5)
  })

  test('表の枠が先頭のままでも、ページを一番上にしたままでも、バーが出て行が動かない。解除したときも動かない', async ({ page }) => {
    await openLineView(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    const target = debitBoxes(page).nth(2)
    await target.scrollIntoViewIfNeeded()
    const before = await boxOf(target)

    await target.check()
    await expect(bulkBar(page)).toBeVisible()
    expect(Math.abs((await boxOf(target)).y - before.y)).toBeLessThan(1.5)

    await bulkBar(page).getByRole('button', { name: '選択を解除' }).click()
    await expect(bulkBar(page)).toHaveCount(0)
    expect(Math.abs((await boxOf(target)).y - before.y)).toBeLessThan(1.5)
  })

  test('表は画面の高さに収まる枠で、ページを一番下までスクロールしても、枠の下端は画面の中にある', async ({ page }) => {
    await openLineView(page)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const region = await boxOf(tableRegion(page))
    expect(region.y + region.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT + 1)
    expect(await tableRegion(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  })

  test('表の枠の中でスクロールしても、表の見出し(借方・貸方と列名)は枠の上端に固定される', async ({ page }) => {
    await openLineView(page)
    const header = page.getByRole('columnheader', { name: '日付' })
    const regionTop = (await boxOf(tableRegion(page))).y

    await tableRegion(page).evaluate((el) => {
      el.scrollTop = 800
    })

    await expect(header).toBeInViewport({ ratio: 1 })
    await expectNotCovered(header)
    const headerBox = await boxOf(header)
    // 見出しは枠の上端(借方・貸方の行の下)に見える。枠の外へスクロールアウトしていない
    expect(headerBox.y).toBeGreaterThanOrEqual(regionTop - 1)
    expect(headerBox.y).toBeLessThan(regionTop + 60)
  })

  test('スクロールしても、タブの行と一括編集バーが画面の上部に見え続け、バーはタブの行の下に重ならずに並ぶ', async ({ page }) => {
    await openLineView(page)
    await debitBoxes(page).nth(2).check()
    await expect(bulkBar(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    await expect(tabList(page)).toBeInViewport({ ratio: 1 })
    await expect(bulkBar(page)).toBeInViewport({ ratio: 1 })
    const tabs = await boxOf(tabList(page))
    const bar = await boxOf(bulkBar(page))
    expect(tabs.y).toBeLessThan(8)
    expect(bar.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
  })

  test('絞り込み欄を開くと、バーは絞り込み欄の下に並び、表の枠の下端も画面の中に収まる', async ({ page }) => {
    await openLineView(page)
    await page.getByRole('button', { name: '絞り込みを開く' }).click()
    await debitBoxes(page).nth(2).check()
    await expect(bulkBar(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const filter = await boxOf(page.getByRole('search', { name: '仕訳の絞り込み' }))
    const bar = await boxOf(bulkBar(page))
    const region = await boxOf(tableRegion(page))
    await expect(page.getByRole('search', { name: '仕訳の絞り込み' })).toBeInViewport({ ratio: 1 })
    expect(bar.y).toBeGreaterThanOrEqual(filter.y + filter.height - 1)
    expect(region.y + region.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT + 1)
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

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    await expect(page.getByRole('heading', { name: '仕訳', level: 1 })).not.toBeInViewport()
  })
})
