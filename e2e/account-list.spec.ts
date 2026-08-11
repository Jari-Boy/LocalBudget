/**
 * 登録済み科目一覧確認画面(計画Issue #70)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面から一覧画面への遷移・トップ画面への復帰、登録済み科目の表示、
 * 0件時の空状態表示を検証する。表示内容の詳細(残高計算・世帯メンバー名併記等)は
 * コンポーネントテスト(AccountListScreen.test.tsx)側で検証済みのため、ここでは
 * トップ画面からの導線が実際のWeb Worker + RPC層を経由して機能することに絞る。
 * account-registration.spec.tsと同様、DB書き込みの永続化はwithAutoSaveの
 * trailing debounce(2秒)を挟むため、作成した科目がRepository経由で確認できるまで
 * pollで待ってからreloadし、Reactアプリ側のWorkerにデータを反映させる。
 * page.goto()直後にpage.evaluate()を呼ぶと、CI環境(低スペックなランナー)では
 * ページの初期ロードが完了しきる前に評価が実行され「Execution context was
 * destroyed, most likely because of a navigation」で失敗することがあるため、
 * トップ画面の見出しが表示される(Reactアプリのマウント完了)のを待ってから
 * evaluateを呼ぶ。
 */
import { test, expect, type Page } from '@playwright/test'

async function waitForAccountCreated(page: Page, accountName: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const accounts = await client.account.findAll()
          return accounts.some((a) => a.name === name)
        }, accountName),
      { timeout: 10000 },
    )
    .toBe(true)
}

test.describe('登録済み科目一覧画面', () => {
  test('トップ画面から一覧画面に遷移でき、登録済み科目が表示される。一覧画面からトップ画面に戻れる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      await client.account.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    })
    await waitForAccountCreated(page, '普通預金')
    await page.reload()

    await page.getByRole('button', { name: '登録済みの科目を見る' }).click()
    await expect(page.getByText('普通預金')).toBeVisible()

    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  })

  test('登録済み科目が0件の場合は空状態が表示される', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '登録済みの科目を見る' }).click()
    await expect(page.getByText('登録済みの科目がありません')).toBeVisible()
  })
})
