/**
 * react-routerベースのナビゲーション基盤(計画Issue #118)のE2Eテスト。実ブラウザ(Chromium)で、
 * 完了条件が明示的に要求する「ブラウザの戻る/進むボタンでも正しく画面遷移できること」を、
 * アプリ内の「戻る」ボタンではなくPlaywrightの`page.goBack()`/`page.goForward()`
 * (ブラウザ本体の戻る/進む操作に相当)で検証する。あわせて、HashRouter採用により
 * ネストしたルートのURLでリロードしても同じ画面に留まる(旧`Screen`型union +
 * `useState`方式では常にトップ画面へ戻っていた)ことも検証する。ホーム画面と中継(ハブ)画面は
 * 計画Issue #150で廃止し、サイドナビと領域タブで移動する。個々の画面の表示内容・
 * 機能自体は他のE2Eテスト(account-list.spec.ts等)で検証済みのため、ここではURL・
 * 履歴ナビゲーションの挙動に絞る。
 */
import { test, expect, type Page } from '@playwright/test'

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'メインメニュー' })
const currentLink = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true })

test.describe('ルーティング基盤(ブラウザの戻る/進む・リロード)', () => {
  test('ルートURLは仕訳領域へ、サイドナビで領域を移動した後にブラウザの戻る/進むで正しく遷移できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(mainNav(page)).toBeVisible()
    await expect(page).toHaveURL(/#\/journal\/entries$/)

    await currentLink(page, 'マスタ').click()
    await expect(page).toHaveURL(/#\/master\/accounts$/)
    await expect(currentLink(page, 'マスタ')).toHaveAttribute('aria-current', 'page')

    await currentLink(page, '割勘・精算').click()
    await expect(page).toHaveURL(/#\/journal\/splitting$/)

    // ブラウザの戻るボタン(page.goBack())で1階層ずつ正しく戻れる
    await page.goBack()
    await expect(page).toHaveURL(/#\/master\/accounts$/)
    await expect(currentLink(page, 'マスタ')).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page).toHaveURL(/#\/journal\/entries$/)

    // ブラウザの進むボタン(page.goForward())で正しく進める
    await page.goForward()
    await expect(page).toHaveURL(/#\/master\/accounts$/)

    await page.goForward()
    await expect(currentLink(page, '割勘・精算')).toHaveAttribute('aria-current', 'page')
  })

  test('領域内のタブで移動した後、ブラウザの戻るボタンで直前のタブへ戻れる', async ({ page }) => {
    await page.goto('/#/master/accounts')
    await expect(currentLink(page, '勘定科目')).toHaveAttribute('aria-current', 'page')

    await currentLink(page, '取引先').click()
    await expect(currentLink(page, '取引先')).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(currentLink(page, '勘定科目')).toHaveAttribute('aria-current', 'page')
  })

  test('ネストしたルート(/master/accounts)でリロードしても同じ画面に留まる(HashRouterによりURLが維持される)', async ({
    page,
  }) => {
    await page.goto('/')
    await currentLink(page, 'マスタ').click()
    await expect(currentLink(page, '勘定科目')).toHaveAttribute('aria-current', 'page')

    await page.reload()

    // reload直後はWorker再起動(WASM読み込み・DB再初期化)が完了するまでレンダリングされず、
    // 続く操作がexpect(既定5000ms)のため、CI環境の低速なランナーでは既定のままだと不足
    // することがある(計画Issue #136でcounterparty-management.spec.tsの同種の箇所がCIでのみ
    // 失敗したのを踏まえた対策)。
    await expect(currentLink(page, '勘定科目')).toHaveAttribute('aria-current', 'page', {
      timeout: 10000,
    })
    await expect(page).toHaveURL(/#\/master\/accounts$/)
  })

  test('廃止した中継画面のURL(/master・/journal等)は各領域の入口画面へリダイレクトされる', async ({
    page,
  }) => {
    await page.goto('/#/master')
    await expect(page).toHaveURL(/#\/master\/accounts$/)

    // 科目の一覧・追加・グループ、定期取引ルールの旧URLは、マスタ画面の該当タブへ(計画Issue #154)
    await page.goto('/#/master/accounts/list')
    await expect(page).toHaveURL(/#\/master\/accounts$/)

    await page.goto('/#/journal/recurring/rules')
    await expect(page).toHaveURL(/#\/master\/recurring$/)

    await page.goto('/#/journal/splitting/new')
    await expect(page).toHaveURL(/#\/journal\/splitting$/)

    await page.goto('/#/journal/splitting/settlement')
    await expect(page).toHaveURL(/#\/journal\/splitting\?tab=settle$/)

    await page.goto('/#/journal/recurring')
    await expect(page).toHaveURL(/#\/journal\/entries\?tab=proposals$/)
  })

  test('存在しないパスへ直接アクセスすると仕訳領域へリダイレクトされる', async ({ page }) => {
    await page.goto('/#/no-such-route')

    await expect(mainNav(page)).toBeVisible()
    await expect(page).toHaveURL(/#\/journal\/entries$/)
  })
})
