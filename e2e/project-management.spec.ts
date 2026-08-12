/**
 * プロジェクト管理画面(計画Issue #36)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からの遷移、新規作成(名称・kind)・編集・非アクティブ化・削除の
 * 一連の操作、および「紐づく仕訳明細が0件なら物理削除可、1件以上なら非アクティブ化
 * のみ」という削除可否の分岐(docs/domain/projects.md 1.3節)が実際のWeb Worker + RPC層を
 * 経由して機能することを検証する。個々の表示ロジックの詳細(kind併記・PL/BS科目残高内訳・
 * 非アクティブ化提案の表示条件等)はコンポーネントテスト(ProjectManagementScreen.*.test.tsx)
 * 側で検証済みのため、ここでは操作フローと削除可否分岐に絞る。account-list.spec.ts・
 * counterparty-management.spec.tsと同様、DB書き込みの永続化はwithAutoSaveのtrailing
 * debounce(2秒)を挟むため、作成したデータがRepository経由で確認できるまでpollで待って
 * からreloadする。
 */
import { test, expect, type Page } from '@playwright/test'

async function waitForProjectCreated(page: Page, name: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetName) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const projects = await client.project.findAll()
          return projects.some((p) => p.name === targetName)
        }, name),
      { timeout: 10000 },
    )
    .toBe(true)
}

test.describe('プロジェクト管理画面', () => {
  test('作成・編集・非アクティブ化・削除の一連の操作ができる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: 'プロジェクトを管理する' }).click()
    await expect(page.getByText('登録済みのプロジェクトがありません')).toBeVisible()

    // 新規作成(kind省略、既定event)
    await page.getByRole('button', { name: 'プロジェクトを追加' }).click()
    await page.getByLabel('名称').fill('26年7月アメリカ旅行')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('26年7月アメリカ旅行')).toBeVisible()

    // 新規作成(kind=settlementを明示指定)
    await page.getByRole('button', { name: 'プロジェクトを追加' }).click()
    await page.getByLabel('名称').fill('26/7生活費割勘')
    await page.getByLabel('種別').selectOption('settlement')
    await page.getByRole('button', { name: '作成する' }).click()
    const settlementItem = page.getByRole('listitem').filter({ hasText: '26/7生活費割勘' })
    await expect(settlementItem).toBeVisible()
    await expect(settlementItem).toContainText('精算バッチ')

    // 編集
    const tripItem = page.getByRole('listitem').filter({ hasText: '26年7月アメリカ旅行' })
    await tripItem.getByRole('button', { name: '編集' }).click()
    await page.getByLabel('名称').fill('26年7月アメリカ旅行(確定)')
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByRole('list').getByText('26年7月アメリカ旅行(確定)')).toBeVisible()

    // 非アクティブ化
    const confirmedTripItem = page.getByRole('listitem').filter({ hasText: '26年7月アメリカ旅行(確定)' })
    await confirmedTripItem.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(confirmedTripItem.getByText('非アクティブ')).toBeVisible()
    await expect(confirmedTripItem.getByRole('button', { name: '非アクティブ化' })).toHaveCount(0)

    // 削除(紐づく仕訳明細が0件のため物理削除できる)
    await settlementItem.getByRole('button', { name: '削除' }).click()
    await expect(page.getByRole('listitem').filter({ hasText: '26/7生活費割勘' })).toHaveCount(0)

    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  })

  test('紐づく仕訳明細が1件以上あるプロジェクトは削除できず、非アクティブ化のみ可能', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const expenseAccount = await client.account.create({
        category: 'expense',
        name: 'お土産代',
        isReconcilable: null,
      })
      const cashAccount = await client.account.create({
        category: 'asset',
        name: '現金',
        isReconcilable: false,
      })
      const project = await client.project.create({ name: '記帳済みの旅行' })
      await client.journalEntry.create({
        entryDate: '2026-07-15',
        memo: null,
        lines: [
          { accountId: expenseAccount.id, side: 'debit', amount: 5000, projectId: project.id },
          { accountId: cashAccount.id, side: 'credit', amount: 5000 },
        ],
      })
    })
    await waitForProjectCreated(page, '記帳済みの旅行')
    await page.reload()

    await page.getByRole('button', { name: 'プロジェクトを管理する' }).click()
    const item = page.getByRole('listitem').filter({ hasText: '記帳済みの旅行' })
    await expect(item).toBeVisible()
    await expect(item.getByRole('button', { name: '削除' })).toHaveCount(0)

    await item.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(item.getByText('非アクティブ')).toBeVisible()
  })
})
