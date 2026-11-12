/**
 * マスタ画面(計画Issue #154)のE2Eテスト。実ブラウザ(Chromium)で、サイドナビの「マスタ」から
 * 勘定科目・取引先・世帯メンバー・プロジェクトのタブを画面遷移なしで切り替えて編集でき、
 * 編集が実際のWeb Worker + RPC層を経由してDBに反映されることに絞って検証する。タブごとの
 * 詳細な振る舞い(削除条件・移動・パターン・統合など)はコンポーネントテスト
 * (src/components/master/*.test.tsx)側で検証済み。
 * DB書き込みの永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、Repository経由で
 * 反映を確認するまでpollで待つ。page.goto()直後にpage.evaluate()を呼ぶと初期ロード完了前に
 * 評価されて失敗することがあるため、サイドナビが表示されるのを待ってからevaluateを呼ぶ。
 */
import { test, expect, type Page } from '@playwright/test'

async function openMasterTab(page: Page, tab: string) {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  await page.getByRole('link', { name: 'マスタ', exact: true }).click()
  await page.getByRole('navigation', { name: '領域内のタブ' }).getByRole('link', { name: tab, exact: true }).click()
}

test.describe('マスタ画面', () => {
  test('サイドナビの「マスタ」で勘定科目タブが開き、標準の収益・費用科目と標準グループが表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await page.getByRole('link', { name: 'マスタ', exact: true }).click()

    await expect(page).toHaveURL(/#\/master\/accounts$/)
    await expect(page.getByRole('button', { name: '食費', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '給与収入', exact: true })).toBeVisible()
    // 新規DBには標準グループ(計画Issue #154)が通常のグループとして投入される
    await expect(page.getByRole('button', { name: '普通預金', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'クレジットカード', exact: true })).toBeVisible()
  })

  test('右パネルのフォームで資産の科目を登録すると、標準グループが初期選択され、一覧に表示される', async ({ page }) => {
    await openMasterTab(page, '勘定科目')

    await page.getByRole('button', { name: '資産に科目を追加' }).click()
    const form = page.getByRole('form', { name: '科目を登録' })
    await expect(form.getByLabel('所属グループ')).toHaveValue(/\d+/)
    await form.getByLabel('名称').fill('楽天銀行')
    await form.getByRole('button', { name: '登録' }).click()

    await expect(page.getByRole('button', { name: '楽天銀行', exact: true })).toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const client = await createDbClient()
            const accounts = await client.account.findAll()
            const groups = await client.accountGroup.findAll()
            const account = accounts.find((a) => a.name === '楽天銀行')
            return groups.find((g) => g.id === account?.accountGroupId)?.name ?? null
          }),
        { timeout: 10000 },
      )
      .toBe('普通預金')
  })

  test('取引先タブで取引先を追加して名前を変えて保存でき、再読み込みしても残る', async ({ page }) => {
    await openMasterTab(page, '取引先')

    await page.getByRole('button', { name: '取引先を追加' }).click()
    const editor = page.getByRole('region', { name: '取引先の編集' })
    await editor.getByLabel('名称').fill('イオン')
    await editor.getByRole('button', { name: '保存' }).click()
    await expect(page.getByRole('button', { name: 'イオン', exact: true })).toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const client = await createDbClient()
            return (await client.counterparty.findAll()).some((c) => c.name === 'イオン')
          }),
        { timeout: 10000 },
      )
      .toBe(true)

    await page.reload()
    await expect(page.getByRole('button', { name: 'イオン', exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('世帯メンバー・プロジェクトの各タブへ切り替えて、項目を追加できる', async ({ page }) => {
    await openMasterTab(page, '世帯メンバー')
    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await expect(page.getByRole('region', { name: '世帯メンバーの編集' })).toBeVisible()

    await page.getByRole('navigation', { name: '領域内のタブ' }).getByRole('link', { name: 'プロジェクト', exact: true }).click()
    await page.getByRole('button', { name: 'プロジェクトを追加' }).click()
    await expect(page.getByRole('region', { name: 'プロジェクトの編集' })).toBeVisible()
  })

  test('仕訳画面の定期仕訳タブで、科目を選んでルールを登録でき、一覧に次回の日付が出る(計画Issue #180)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      await client.account.create({ category: 'asset', name: '手元現金(定期仕訳)', isReconcilable: false })
    })
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const client = await createDbClient()
            return (await client.account.findAll()).some((a) => a.name === '手元現金(定期仕訳)')
          }),
        { timeout: 10000 },
      )
      .toBe(true)
    await page.reload()

    await page.goto('/#/journal/entries?tab=rules')

    await page.getByRole('button', { name: '定期仕訳を追加' }).click()
    const form = page.getByRole('region', { name: '定期仕訳の追加' })
    await form.getByLabel('名称').fill('Netflix')
    // 借方・貸方は、仕訳の起票と同じ行編集の共通部品(計画Issue #180)
    const debit = form.getByRole('group', { name: '借方' })
    const credit = form.getByRole('group', { name: '貸方' })
    await debit.getByRole('button', { name: /^科目/ }).click()
    await page.getByRole('dialog', { name: '科目' }).getByRole('button', { name: '娯楽費', exact: true }).click()
    await credit.getByRole('button', { name: /^科目/ }).click()
    await page.getByRole('dialog', { name: '科目' }).getByRole('button', { name: '手元現金(定期仕訳)', exact: true }).click()
    await debit.getByLabel('娯楽費の金額').fill('1590')
    await credit.getByLabel('手元現金(定期仕訳)の金額').fill('1590')
    await form.getByLabel('日', { exact: true }).selectOption('19')
    await form.getByRole('button', { name: '登録' }).click()

    const row = page.getByRole('row', { name: /Netflix/ })
    await expect(row).toBeVisible()
    await expect(row).toContainText('毎月19日')
    await expect(row).toContainText(/\d{4}\/\d{2}\/19/)
  })
})
