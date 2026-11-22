/**
 * 上部固定のタブ・絞り込み欄・一括編集バー(計画Issue #266)のE2Eテスト。
 * 仕訳一覧の「明細行単位」の表で、(1)最初のチェックでバーが出ても選んだ行の画面上の位置が動かないこと、
 * (2)縦にスクロールしても、タブの行と一括編集バーが画面の上部に見え続け、バーがタブの行に重ならないこと、
 * (3)絞り込み欄を開いてもバーが絞り込み欄に重ならないこと、(4)確認のダイアログが固定領域の上に出ることを、
 * 実ブラウザ(Chromium)で検証する。CSS(position: sticky・領域の確保)の効き方はjsdomで再現できないため、Playwrightで検証する。
 * 縦に長い一覧は、仕訳を40件作って用意する。事前データ準備はpage.evaluate内の別Workerで行い、flush()してからreloadする。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

const VIEW_KEY = 'localbudget:journal-view-mode'

/** 仕訳を40件作り、明細行単位の表示で仕訳一覧を開く */
async function openLineView(page: Page) {
  await page.setViewportSize({ width: 1400, height: 720 })
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

async function boxOf(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

test.describe('上部固定の一括編集バーとタブ(明細行単位)', () => {
  test('最初のチェックを付けてバーが出ても、選んだ行の画面上の位置は動かない', async ({ page }) => {
    await openLineView(page)
    // 少し下へスクロールしてから、画面の中ほどの行を選ぶ(スクロール位置が勝手に変わらないことも確かめる)
    await page.evaluate(() => window.scrollTo(0, 300))
    const target = debitBoxes(page).nth(8)
    const before = await boxOf(target)
    const scrollBefore = await page.evaluate(() => window.scrollY)

    await target.check()
    await expect(bulkBar(page)).toBeVisible()

    const after = await boxOf(target)
    expect(Math.abs(after.y - before.y)).toBeLessThan(1)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  })

  test('スクロールしても、タブの行と一括編集バーが画面の上部に見え続け、バーはタブの行の下に重ならずに並ぶ', async ({ page }) => {
    await openLineView(page)
    await debitBoxes(page).nth(2).check()
    await expect(bulkBar(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, 1200))

    await expect(tabList(page)).toBeInViewport({ ratio: 1 })
    await expect(bulkBar(page)).toBeInViewport({ ratio: 1 })
    const tabs = await boxOf(tabList(page))
    const bar = await boxOf(bulkBar(page))
    expect(tabs.y).toBeLessThan(8)
    expect(bar.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
  })

  test('絞り込み欄を開いても、一括編集バーは絞り込み欄の下に並び、重ならない', async ({ page }) => {
    await openLineView(page)
    await page.getByRole('button', { name: '絞り込みを開く' }).click()
    await debitBoxes(page).nth(2).check()
    await expect(bulkBar(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, 1200))

    const filter = await boxOf(page.getByRole('search', { name: '仕訳の絞り込み' }))
    const bar = await boxOf(bulkBar(page))
    await expect(page.getByRole('search', { name: '仕訳の絞り込み' })).toBeInViewport({ ratio: 1 })
    expect(bar.y).toBeGreaterThanOrEqual(filter.y + filter.height - 1)
  })

  test('絞り込み欄を開閉しても、一括編集バーは絞り込み欄の下に追従する(高さの変化に追いつく)', async ({ page }) => {
    await openLineView(page)
    await debitBoxes(page).nth(2).check()
    await page.evaluate(() => window.scrollTo(0, 1200))
    const closedY = (await boxOf(bulkBar(page))).y

    await page.getByRole('button', { name: '絞り込みを開く' }).click()
    const openY = (await boxOf(bulkBar(page))).y

    expect(openY).toBeGreaterThan(closedY + 20)
    await page.getByRole('button', { name: '絞り込みを閉じる' }).click()
    expect(Math.abs((await boxOf(bulkBar(page))).y - closedY)).toBeLessThan(1)
  })

  test('「適用」の確認ダイアログは、固定されたタブの行より手前に出て、画面全体を覆う', async ({ page }) => {
    await openLineView(page)
    await debitBoxes(page).nth(2).check()
    await page.evaluate(() => window.scrollTo(0, 600))
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

    await page.evaluate(() => window.scrollTo(0, 1200))

    await expect(page.getByRole('heading', { name: '仕訳', level: 1 })).not.toBeInViewport()
  })
})
