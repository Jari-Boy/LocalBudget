/**
 * プロジェクト管理画面(計画Issue #36)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からの遷移、新規作成(名称)・編集・非アクティブ化・削除の一連の操作、
 * および「紐づく仕訳明細が0件なら物理削除可、1件以上なら非アクティブ化のみ」という
 * 削除可否の分岐(docs/domain/projects.md 1.3節)が実際のWeb Worker + RPC層を経由して
 * 機能することを検証する。プロジェクトは計画Issue #133でイベント専用となり`kind`は
 * 廃止された(精算バッチとしての役割はsettlement_batchesへ分離、expense-splitting.spec.ts
 * 参照)。個々の表示ロジックの詳細(PL/BS科目残高内訳・非アクティブ化提案の表示条件等)は
 * コンポーネントテスト(ProjectManagementScreen.*.test.tsx)側で検証済みのため、ここでは
 * 操作フローと削除可否分岐に絞る。account-list.spec.ts・counterparty-management.spec.tsと
 * 同様、DB書き込みの永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、作成した
 * データがRepository経由で確認できるまでpollで待ってからreloadする。
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
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await page.getByRole('link', { name: 'プロジェクト', exact: true }).click()
    await expect(page.getByText('登録済みのプロジェクトがありません')).toBeVisible()

    // 新規作成
    await page.getByRole('button', { name: 'プロジェクトを追加' }).click()
    await page.getByLabel('名称').fill('26年7月アメリカ旅行')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('table').getByText('26年7月アメリカ旅行')).toBeVisible()

    // 2件目の新規作成(削除可否分岐の検証用)
    await page.getByRole('button', { name: 'プロジェクトを追加' }).click()
    await page.getByLabel('名称').fill('26年8月の帰省')
    await page.getByRole('button', { name: '作成する' }).click()
    const secondItem = page.getByRole('rowgroup').filter({ hasText: '26年8月の帰省' })
    await expect(secondItem).toBeVisible()

    // 編集
    const tripItem = page.getByRole('rowgroup').filter({ hasText: '26年7月アメリカ旅行' })
    await tripItem.getByRole('button', { name: '編集' }).click()
    await page.getByLabel('名称').fill('26年7月アメリカ旅行(確定)')
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByRole('table').getByText('26年7月アメリカ旅行(確定)')).toBeVisible()

    // 非アクティブ化
    const confirmedTripItem = page.getByRole('rowgroup').filter({ hasText: '26年7月アメリカ旅行(確定)' })
    await confirmedTripItem.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(confirmedTripItem.getByRole('button', { name: 'アクティブ化' })).toBeVisible()
    await expect(confirmedTripItem.getByRole('button', { name: '非アクティブ化' })).toHaveCount(0)

    // 削除(紐づく仕訳明細が0件のため物理削除できる)
    await secondItem.getByRole('button', { name: '削除' }).click()
    await expect(page.getByRole('rowgroup').filter({ hasText: '26年8月の帰省' })).toHaveCount(0)

    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('link', { name: '科目一覧', exact: true })).toHaveAttribute('aria-current', 'page')
  })

  test('紐づく仕訳明細が1件以上あるプロジェクトは削除できず、非アクティブ化のみ可能', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

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
      const [defaultMember] = await client.householdMember.findAll()
      await client.journalEntry.create({
        entryDate: '2026-07-15',
        memo: null,
        householdMemberId: defaultMember.id,
        lines: [
          { accountId: expenseAccount.id, side: 'debit', amount: 5000, projectId: project.id },
          { accountId: cashAccount.id, side: 'credit', amount: 5000 },
        ],
      })
    })
    await waitForProjectCreated(page, '記帳済みの旅行')
    await page.reload()

    await page.getByRole('link', { name: 'マスタ', exact: true }).click()
    await page.getByRole('link', { name: 'プロジェクト', exact: true }).click()
    const item = page.getByRole('rowgroup').filter({ hasText: '記帳済みの旅行' })
    await expect(item).toBeVisible()
    await expect(item.getByRole('button', { name: '削除' })).toHaveCount(0)

    await item.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(item.getByRole('button', { name: 'アクティブ化' })).toBeVisible()
  })
})
