/**
 * 設定画面からのバックアップの書き出し・読み込み(計画Issue #173)のE2Eテスト。実ブラウザ(Chromium)で、
 * サイドナビの「設定」から書き出したファイルを、データを変えた後に読み込むと、確認ダイアログ →
 * ページの再読み込みを経て書き出した時点のデータに戻り、完了のお知らせが出ることを検証する。
 * 読み込めないファイルでは、データを変えずに理由を示すことも検証する。
 *
 * データの用意と確認は画面の操作だけで行い、page.evaluate()でcreateDbClient()を作らない。
 * 別のクライアント(別のWorker)はそれぞれ自分のDBを持ち、ページの再読み込み時のpagehideで
 * 自分の(古い)DBを保存先へ書き戻すため、読み込んだ内容が上書きされたかどうかを正しく
 * 確かめられなくなる。なお、アプリ自身のWorkerが読み込み後の再読み込みで古いDBを書き戻さないための
 * AutoSaveController.stop()は、stop()を外してもこのテストが通ることを実装時に確認している
 * (Chromiumでは、再読み込み時のpagehideからのflush()がWorkerの終了までに保存を終えられないため)。
 * stop()は起きうる競合への備えであり、その振る舞いはwithAutoSave.test.tsで検証する。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

async function openFromNav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name, exact: true }).click()
}

async function addAssetAccount(page: Page, name: string) {
  await openFromNav(page, 'マスタ')
  await page.getByRole('button', { name: '資産に科目を追加' }).click()
  const form = page.getByRole('form', { name: '科目を登録' })
  await form.getByLabel('名称').fill(name)
  await form.getByRole('button', { name: '登録' }).click()
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
}

test.describe('設定画面のバックアップ', () => {
  test('書き出したファイルを読み込むと、再読み込みを経て書き出した時点のデータに戻り、完了が知らされる', async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await addAssetAccount(page, '設定バックアップ口座A')

    await openFromNav(page, '設定')
    await expect(page).toHaveURL(/#\/settings$/)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '書き出す', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^local-budget-backup-\d{8}-\d{4}\.sqlite$/)
    const backupPath = testInfo.outputPath(download.suggestedFilename())
    await download.saveAs(backupPath)

    // 書き出した後に加えたデータは、読み込みで消えるはず
    await addAssetAccount(page, '設定バックアップ口座B')

    await openFromNav(page, '設定')
    await page.getByLabel('読み込むバックアップファイル').setInputFiles(backupPath)
    const dialog = page.getByRole('dialog', { name: 'バックアップから読み込みます' })
    await expect(dialog).toContainText(download.suggestedFilename())
    await dialog.getByRole('button', { name: '置き換えて読み込む' }).click()

    // 読み込みが終わるとページが再読み込みされ、設定画面に完了のお知らせが出る
    await expect(page.getByRole('status')).toContainText(
      `バックアップから読み込みました(${download.suggestedFilename()})`,
      { timeout: 15000 },
    )
    await expect(page).toHaveURL(/#\/settings$/)

    await openFromNav(page, 'マスタ')
    await expect(page.getByRole('button', { name: '設定バックアップ口座A', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '設定バックアップ口座B', exact: true })).toHaveCount(0)

    // 再読み込みの後に、古いDBが遅れて書き戻されていないことを、もう一度読み込み直して確かめる
    await page.reload()
    await expect(page.getByRole('button', { name: '設定バックアップ口座A', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '設定バックアップ口座B', exact: true })).toHaveCount(0)
  })

  test('読み込めないファイルを選ぶと、データを変えずに理由を示す', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await addAssetAccount(page, '設定バックアップ口座C')

    await openFromNav(page, '設定')
    await page.getByLabel('読み込むバックアップファイル').setInputFiles({
      name: 'photo-2026.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('this is not a sqlite database file'),
    })
    await page
      .getByRole('dialog', { name: 'バックアップから読み込みます' })
      .getByRole('button', { name: '置き換えて読み込む' })
      .click()

    const error = page.getByRole('alertdialog', { name: 'このファイルは読み込めません' })
    await expect(error).toContainText('photo-2026.jpg')
    await expect(error).toContainText('今のデータは変更していません')
    await error.getByRole('button', { name: '閉じる' }).click()
    await expect(error).toHaveCount(0)

    await openFromNav(page, 'マスタ')
    await expect(page.getByRole('button', { name: '設定バックアップ口座C', exact: true })).toBeVisible()
  })
})
