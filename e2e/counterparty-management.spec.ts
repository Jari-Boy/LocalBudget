/**
 * 取引先管理画面(計画Issue #38、計画Issue #85で学習済みパターンの
 * 一覧表示・編集・削除を追加)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からの遷移、新規作成・編集・削除・非アクティブ化・統合、
 * および学習済みパターンの展開・編集・削除の一連の操作が実際の
 * Web Worker + RPC層を経由して機能することを検証する。
 * 個々の画面表示ロジックの詳細(0件時の空状態、default_account_id併記等)は
 * コンポーネントテスト(CounterpartyManagementScreen.*.test.tsx)側で検証済みのため、
 * ここでは一連の操作フローに絞る。account-list.spec.tsと同様、DB書き込みの
 * 永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、作成した取引先が
 * Repository経由で確認できるまでpollで待ってからreloadする。
 */
import { test, expect, type Page } from '@playwright/test'

async function waitForCounterpartyCreated(page: Page, name: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetName) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const counterparties = await client.counterparty.findAll()
          return counterparties.some((c) => c.name === targetName)
        }, name),
      { timeout: 10000 },
    )
    .toBe(true)
}

/** counterpartyNameに紐づくパターン件数がexpectedCountになるまで待つ(withAutoSaveのdebounce対策) */
async function waitForPatternCount(page: Page, counterpartyName: string, expectedCount: number) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetName) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const counterparty = (await client.counterparty.findAll()).find((c) => c.name === targetName)
          if (!counterparty) return -1
          return (await client.counterparty.findPatternsByCounterparty(counterparty.id)).length
        }, counterpartyName),
      { timeout: 10000 },
    )
    .toBe(expectedCount)
}

test.describe('取引先管理画面', () => {
  test('作成・編集・非アクティブ化・削除・統合の一連の操作ができる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '取引先を管理する' }).click()
    await expect(page.getByText('登録済みの取引先がありません')).toBeVisible()

    // 新規作成
    await page.getByRole('button', { name: '取引先を追加' }).click()
    await page.getByLabel('名称').fill('ローソン 東京日本橋店')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('ローソン 東京日本橋店')).toBeVisible()

    await page.getByRole('button', { name: '取引先を追加' }).click()
    await page.getByLabel('名称').fill('ローソン 大阪梅田店')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('ローソン 大阪梅田店')).toBeVisible()

    await page.getByRole('button', { name: '取引先を追加' }).click()
    await page.getByLabel('名称').fill('ローソン')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('ローソン', { exact: true })).toBeVisible()

    // 編集
    const tokyoItem = page.getByRole('listitem').filter({ hasText: 'ローソン 東京日本橋店' })
    await tokyoItem.getByRole('button', { name: '編集' }).click()
    await page.getByLabel('名称').fill('ローソン 東京日本橋本店')
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByRole('list').getByText('ローソン 東京日本橋本店')).toBeVisible()

    // 統合: 「ローソン 東京日本橋本店」「ローソン 大阪梅田店」→「ローソン」
    await page
      .getByRole('listitem')
      .filter({ hasText: 'ローソン 東京日本橋本店' })
      .getByRole('checkbox')
      .check()
    await page
      .getByRole('listitem')
      .filter({ hasText: 'ローソン 大阪梅田店' })
      .getByRole('checkbox')
      .check()
    await page.getByLabel('統合先').selectOption({ label: 'ローソン' })
    await page.getByRole('button', { name: '統合を実行' }).click()
    await page.getByRole('button', { name: '統合を確定' }).click()

    const mergeResult = page.getByRole('status', { name: '統合結果' })
    await expect(mergeResult).toBeVisible()
    await expect(mergeResult).toContainText('ローソン')

    // 削除(統合元は仕訳明細0件のため物理削除可能)
    await page
      .getByRole('listitem')
      .filter({ hasText: 'ローソン 東京日本橋本店' })
      .getByRole('button', { name: '削除' })
      .click()
    await expect(page.getByRole('list').getByText('ローソン 東京日本橋本店')).toHaveCount(0)

    // 非アクティブ化
    const osakaItem = page.getByRole('listitem').filter({ hasText: 'ローソン 大阪梅田店' })
    await osakaItem.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(osakaItem).toContainText('非アクティブ')

    // トップ画面へ戻る
    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  })

  test('紐づく仕訳明細が1件以上ある取引先には削除ボタンが表示されず、非アクティブ化のみ可能', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const expenseAccount = await client.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      })
      const cashAccount = await client.account.create({
        category: 'asset',
        name: '現金',
        isReconcilable: false,
      })
      const counterparty = await client.counterparty.create({ name: 'イオン' })
      const [defaultMember] = await client.householdMember.findAll()
      await client.journalEntry.create({
        entryDate: '2026-08-11',
        householdMemberId: defaultMember.id,
        lines: [
          { accountId: expenseAccount.id, side: 'debit', amount: 1000, counterpartyId: counterparty.id },
          { accountId: cashAccount.id, side: 'credit', amount: 1000 },
        ],
      })
    })
    await waitForCounterpartyCreated(page, 'イオン')
    await page.reload()

    await page.getByRole('button', { name: '取引先を管理する' }).click()
    const item = page.getByRole('listitem').filter({ hasText: 'イオン' })
    await expect(item.getByRole('button', { name: '削除' })).toHaveCount(0)
    await expect(item.getByRole('button', { name: '非アクティブ化' })).toBeVisible()
  })

  test('学習済みパターンの一覧表示・編集・削除ができる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '取引先を管理する' }).click()
    await page.getByRole('button', { name: '取引先を追加' }).click()
    await page.getByLabel('名称').fill('イオン')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('イオン')).toBeVisible()

    const item = page.getByRole('listitem').filter({ hasText: 'イオン' })
    await expect(item.getByRole('button', { name: '登録済みパターン: 0件' })).toBeVisible()
    await item.getByRole('button', { name: '登録済みパターン: 0件' }).click()
    await expect(item.getByText('登録済みのパターンはありません')).toBeVisible()

    // CSV取込時の学習(docs/domain/counterparties.md 1.3)はstatement-import側の責務であり
    // 本テストのスコープ外のため、ここではRepository経由でパターンを直接登録する。
    // page.evaluate内のcreateDbClient()はアプリ本体とは別のWeb Workerインスタンスを
    // 生成するため、まず作成済み取引先の永続化(withAutoSaveのdebounce)を待ってから
    // パターンを追加し、そのパターン自体の永続化も待ってからreloadして反映させる
    await waitForCounterpartyCreated(page, 'イオン')
    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const counterparty = (await client.counterparty.findAll()).find((c) => c.name === 'イオン')!
      await client.counterparty.addPattern(counterparty.id, 'AEON')
    })
    await waitForPatternCount(page, 'イオン', 1)
    await page.reload()
    await page.getByRole('button', { name: '取引先を管理する' }).click()

    const reopenedItem = page.getByRole('listitem').filter({ hasText: 'イオン' })
    await expect(reopenedItem.getByRole('button', { name: '登録済みパターン: 1件' })).toBeVisible()
    await reopenedItem.getByRole('button', { name: '登録済みパターン: 1件' }).click()
    await expect(reopenedItem.getByText('AEON')).toBeVisible()

    // 編集
    await reopenedItem.getByRole('button', { name: 'パターンを編集' }).click()
    await reopenedItem.getByLabel('パターン文字列').fill('AEON MALL')
    await reopenedItem.getByRole('button', { name: '保存する' }).click()
    await expect(reopenedItem.getByText('AEON MALL')).toBeVisible()
    await expect(reopenedItem.getByText('AEON', { exact: true })).toHaveCount(0)

    // 削除
    await reopenedItem.getByRole('button', { name: 'パターンを削除' }).click()
    await expect(reopenedItem.getByRole('button', { name: '登録済みパターン: 0件' })).toBeVisible()
    await expect(reopenedItem.getByText('登録済みのパターンはありません')).toBeVisible()
  })
})
