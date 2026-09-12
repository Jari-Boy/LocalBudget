/**
 * react-routerベースのナビゲーション基盤(計画Issue #118)のE2Eテスト。実ブラウザ(Chromium)で、
 * 完了条件が明示的に要求する「ブラウザの戻る/進むボタンでも正しく画面遷移できること」を、
 * アプリ内の「戻る」ボタンではなくPlaywrightの`page.goBack()`/`page.goForward()`
 * (ブラウザ本体の戻る/進む操作に相当)で検証する。あわせて、HashRouter採用により
 * ネストしたルートのURLでリロードしても同じ画面に留まる(旧`Screen`型union +
 * `useState`方式では常にトップ画面へ戻っていた)ことも検証する。個々の画面の表示内容・
 * 機能自体は他のE2Eテスト(account-list.spec.ts等)で検証済みのため、ここではURL・
 * 履歴ナビゲーションの挙動に絞る。
 */
import { test, expect } from '@playwright/test'

test.describe('ルーティング基盤(ブラウザの戻る/進む・リロード)', () => {
  test('ホーム→マスタ管理ハブ→科目管理ハブと進んだ後、ブラウザの戻る/進むボタンで正しく画面遷移できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: 'マスタ管理' }).click()
    await expect(page.getByRole('heading', { name: 'マスタ管理' })).toBeVisible()

    await page.getByRole('button', { name: '科目を管理する' }).click()
    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()

    // ブラウザの戻るボタン(page.goBack())で1階層ずつ正しく戻れる
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'マスタ管理' })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    // ブラウザの進むボタン(page.goForward())で正しく進める
    await page.goForward()
    await expect(page.getByRole('heading', { name: 'マスタ管理' })).toBeVisible()

    await page.goForward()
    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()
  })

  test('仕訳ハブ→割勘サブハブと進んだ後、ブラウザの戻るボタンで正しく画面遷移できる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '仕訳' }).click()
    await expect(page.getByRole('heading', { name: '仕訳' })).toBeVisible()

    await page.getByRole('button', { name: '割勘', exact: true }).click()
    await expect(page.getByRole('heading', { name: '割勘', exact: true })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: '仕訳' })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  })

  test('ネストしたルート(/master/accounts)でリロードしても同じ画面に留まる(HashRouterによりURLが維持される)', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'マスタ管理' }).click()
    await page.getByRole('button', { name: '科目を管理する' }).click()
    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()

    await page.reload()

    // 旧実装(Screen型union + useStateのみ、URLに状態を持たない)では
    // リロードすると常にトップ画面(LocalBudget)へ戻っていたが、HashRouter導入後は
    // リロードしてもURL(#/master/accounts)がそのまま維持され、同じ画面が再表示される。
    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()
  })

  test('存在しないパスへ直接アクセスするとホーム画面へリダイレクトされる', async ({ page }) => {
    await page.goto('/#/no-such-route')

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  })
})
