/**
 * ローカルフォルダへのデータベース保存(計画Issue #174)のE2Eテスト。実ブラウザ(Chromium)で、
 * 設定画面から保存先をフォルダに切り替え、データがフォルダのDBファイルに保存されること、再読み込み後も
 * 保存先が保たれること、ブラウザ内へ戻せること、既存ファイルを開けること、起動時にフォルダの権限が
 * 「確認が必要」に戻っていれば再接続画面が出ること、2つ目のタブが読み取り専用になること、
 * フォルダ選択に非対応の環境で選択肢が無効になることを検証する。計画Issue #175では、同期フォルダの
 * 注意書きの表示と、フォルダのファイルが外部で更新された後の保存が上書きされず警告が出ること
 * (開き直すと復帰すること)を検証する。
 *
 * showDirectoryPickerは実際のOSダイアログを開くためPlaywrightから操作できない。file-system-access-storage-adapter
 * .spec.tsと同じく、Origin Private File Systemの本物のFileSystemDirectoryHandleを返す偽物に差し替える
 * (addInitScriptで入れるので再読み込み後も有効)。権限の「確認が必要」への戻りは、メインスレッドの
 * queryPermission/requestPermissionをlocalStorageの印で差し替えて再現する(Workerは本物のまま)。
 * データの用意と確認は画面の操作だけで行い、page.evaluate()でcreateDbClient()を作らない
 * (別のWorkerが自分のDBを書き戻し、結果を乱すため。e2e/settings-backup.spec.tsと同じ理由)。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect, type Page } from '@playwright/test'

const FOLDER_NAME = 'e2e-sync-folder'
const PERMISSION_KEY = 'e2e-folder-permission'

/** フォルダ選択をOPFSのフォルダに差し替え、権限の状態をlocalStorageの印で操作できるようにする。 */
async function stubFolderPicker(page: Page) {
  await page.addInitScript(
    ({ folderName, permissionKey }) => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle(folderName, { create: true })
      }
      const originalQuery = FileSystemDirectoryHandle.prototype.queryPermission
      FileSystemDirectoryHandle.prototype.queryPermission = function (descriptor) {
        const forced = localStorage.getItem(permissionKey)
        return forced ? Promise.resolve(forced as PermissionState) : originalQuery.call(this, descriptor)
      }
      FileSystemDirectoryHandle.prototype.requestPermission = async () => {
        localStorage.removeItem(permissionKey)
        return 'granted'
      }
    },
    { folderName: FOLDER_NAME, permissionKey: PERMISSION_KEY },
  )
}

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

async function expectAccount(page: Page, name: string, visible = true) {
  await openFromNav(page, 'マスタ')
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(visible ? 1 : 0)
}

function storageRegion(page: Page) {
  return page.getByRole('region', { name: 'データの保存先' })
}

/** 設定画面で「フォルダを選ぶ…」を押し、空のフォルダ(既存ファイルなし)への切り替えを済ませる。 */
async function switchToFolder(page: Page) {
  await openFromNav(page, '設定')
  await storageRegion(page).getByRole('button', { name: 'フォルダを選ぶ…' }).click()
}

/** フォルダ内のDBファイルのサイズ。無ければnull。 */
async function folderFileSize(page: Page): Promise<number | null> {
  return page.evaluate(async (folderName) => {
    const root = await navigator.storage.getDirectory()
    try {
      const folder = await root.getDirectoryHandle(folderName)
      return (await (await folder.getFileHandle('local-budget.sqlite')).getFile()).size
    } catch {
      return null
    }
  }, FOLDER_NAME)
}

/** フォルダ内のDBファイルの更新日時。無ければnull。 */
async function folderFileModified(page: Page): Promise<number | null> {
  return page.evaluate(async (folderName) => {
    const root = await navigator.storage.getDirectory()
    try {
      const folder = await root.getDirectoryHandle(folderName)
      return (await (await folder.getFileHandle('local-budget.sqlite')).getFile()).lastModified
    } catch {
      return null
    }
  }, FOLDER_NAME)
}

test.describe('ローカルフォルダへの保存', () => {
  test.beforeEach(async ({ page }) => {
    await stubFolderPicker(page)
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  })

  test('フォルダに切り替えると、今のデータがフォルダに保存され、再読み込み後も保存先が保たれる', async ({ page }) => {
    await addAssetAccount(page, 'フォルダ保存口座A')

    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await expect(storageRegion(page)).toContainText('local-budget.sqlite')
    await expect.poll(() => folderFileSize(page)).toBeGreaterThan(0)

    // 切り替え後に加えたデータもフォルダに保存され、再読み込みしても残る
    const modifiedBefore = await folderFileModified(page)
    await addAssetAccount(page, 'フォルダ保存口座B')
    // 自動保存は最後の変更の2秒後(デバウンス)なので、ファイルが更新されたのを待ってから再読み込みする
    await expect.poll(() => folderFileModified(page), { timeout: 10000 }).toBeGreaterThan(modifiedBefore ?? 0)
    await page.reload()
    await openFromNav(page, '設定')
    await expect(storageRegion(page)).toContainText(FOLDER_NAME)
    await expectAccount(page, 'フォルダ保存口座A')
    await expectAccount(page, 'フォルダ保存口座B')
  })

  test('ブラウザ内へ「フォルダの最新をコピー」して戻すと、データを引き継いだままブラウザ内の保存先になる', async ({
    page,
  }) => {
    await addAssetAccount(page, 'コピー戻し口座A')
    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await addAssetAccount(page, 'コピー戻し口座B')
    await openFromNav(page, '設定')

    await storageRegion(page).getByRole('button', { name: 'ブラウザ保存に戻す…' }).click()
    await page
      .getByRole('dialog', { name: 'ブラウザ保存に戻します' })
      .getByRole('button', { name: 'ブラウザ保存に戻す' })
      .click()

    await expect(storageRegion(page)).toContainText('このブラウザ内', { timeout: 15000 })
    await expectAccount(page, 'コピー戻し口座A')
    await expectAccount(page, 'コピー戻し口座B')
  })

  test('既存のDBファイルがあるフォルダを選んで「開く」と、フォルダのデータに切り替わる', async ({ page }) => {
    // フォルダにデータ(口座A・B)を置き、ブラウザ内には口座Aだけを残して戻る
    await addAssetAccount(page, '既存ファイル口座A')
    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await addAssetAccount(page, '既存ファイル口座B')
    await expect.poll(() => folderFileSize(page)).toBeGreaterThan(0)
    await openFromNav(page, '設定')
    await storageRegion(page).getByRole('button', { name: 'ブラウザ保存に戻す…' }).click()
    const revert = page.getByRole('dialog', { name: 'ブラウザ保存に戻します' })
    await revert.getByRole('radio', { name: /古いデータをそのまま使う/ }).check()
    await revert.getByRole('button', { name: 'ブラウザ保存に戻す' }).click()
    await expect(storageRegion(page)).toContainText('このブラウザ内', { timeout: 15000 })
    await expectAccount(page, '既存ファイル口座B', false)

    // 同じフォルダをもう一度選ぶと、既存ファイルの選択が出る。「開く」でフォルダのデータになる
    await openFromNav(page, '設定')
    await storageRegion(page).getByRole('button', { name: 'フォルダを選ぶ…' }).click()
    const existing = page.getByRole('dialog', { name: 'このフォルダには、すでにデータがあります' })
    await expect(existing).toContainText('local-budget.sqlite')
    await existing.getByRole('button', { name: 'この内容で進む' }).click()

    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await expectAccount(page, '既存ファイル口座B')
  })

  test('既存のファイルがLocalBudgetのDBでなければ、開かずに理由を示し、データを変えない', async ({ page }) => {
    await addAssetAccount(page, '不正ファイル口座')
    await page.evaluate(async (folderName) => {
      const root = await navigator.storage.getDirectory()
      const folder = await root.getDirectoryHandle(folderName, { create: true })
      const writable = await (await folder.getFileHandle('local-budget.sqlite', { create: true })).createWritable()
      await writable.write(new Blob(['this is not a sqlite database file']))
      await writable.close()
    }, FOLDER_NAME)

    await openFromNav(page, '設定')
    await storageRegion(page).getByRole('button', { name: 'フォルダを選ぶ…' }).click()
    await page
      .getByRole('dialog', { name: 'このフォルダには、すでにデータがあります' })
      .getByRole('button', { name: 'この内容で進む' })
      .click()

    const alert = page.getByRole('alertdialog')
    await expect(alert).toContainText('このフォルダのファイルは開けません')
    await expect(alert).toContainText('今のデータは変更していません')
    await alert.getByRole('button', { name: '閉じる' }).click()
    await expect(storageRegion(page)).toContainText('このブラウザ内')
    await expectAccount(page, '不正ファイル口座')
  })

  test('フォルダの権限が「確認が必要」に戻っていると、DBを開かず再接続画面を出し、再接続で通常起動する', async ({ page }) => {
    await addAssetAccount(page, '再接続口座')
    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await expect.poll(() => folderFileSize(page)).toBeGreaterThan(0)

    await page.evaluate((key) => localStorage.setItem(key, 'prompt'), PERMISSION_KEY)
    await page.reload()

    await expect(page.getByRole('heading', { name: 'フォルダに再接続してください' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toHaveCount(0)

    await page.getByRole('button', { name: 'フォルダに再接続する' }).click()
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await expectAccount(page, '再接続口座')
  })

  test('再接続画面から、ブラウザ内に戻せる', async ({ page }) => {
    await addAssetAccount(page, '再接続戻し口座')
    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })

    await page.evaluate((key) => localStorage.setItem(key, 'prompt'), PERMISSION_KEY)
    await page.reload()
    await page.getByRole('button', { name: 'ブラウザ保存に戻す…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'ブラウザ保存に戻す' }).click()

    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible({ timeout: 15000 })
    await openFromNav(page, '設定')
    await expect(storageRegion(page)).toContainText('このブラウザ内')
  })
})

/** 別の端末の同期クライアントがファイルを置き換えた状況を再現する(内容はそのままで更新日時だけ進める)。 */
async function touchFolderFileExternally(page: Page) {
  await page.evaluate(async (folderName) => {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle(folderName)
    const handle = await folder.getFileHandle('local-budget.sqlite')
    const bytes = await (await handle.getFile()).arrayBuffer()
    // 更新日時が同じ値にならないよう、少し待ってから書き直す
    await new Promise((resolve) => setTimeout(resolve, 50))
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }, FOLDER_NAME)
}

test.describe('同期フォルダの外部変更の検知(計画Issue #175)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFolderPicker(page)
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  })

  test('フォルダ保存を選ぶ設定画面に、1台だけで編集する旨とリアルタイム同期ではない旨の注意書きが出る', async ({ page }) => {
    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await expect(storageRegion(page)).toContainText('同時に編集できるのは1台だけ')
    await expect(storageRegion(page)).toContainText('リアルタイム同期ではありません')
  })

  test('ファイルが外部で更新された後の変更は上書き保存されず、警告が出る。開き直すと警告が消える', async ({ page }) => {
    await switchToFolder(page)
    await expect(storageRegion(page)).toContainText(FOLDER_NAME, { timeout: 15000 })
    await expect.poll(() => folderFileSize(page)).toBeGreaterThan(0)

    await touchFolderFileExternally(page)
    const modifiedByOthers = await folderFileModified(page)
    await addAssetAccount(page, '外部変更後の口座')

    const alert = page.getByRole('alert').filter({ hasText: '保存を停止しています' })
    await expect(alert).toBeVisible({ timeout: 15000 })
    await expect(alert).toContainText('保存されていません')
    // 他の端末が更新したファイルを、古い内容で上書きしていない
    expect(await folderFileModified(page)).toBe(modifiedByOthers)

    await alert.getByRole('button', { name: 'フォルダのファイルを開き直す' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '破棄して開き直す' }).click()

    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '保存を停止しています' })).toHaveCount(0)
    // 破棄した入力は、フォルダのファイルに無い
    await expectAccount(page, '外部変更後の口座', false)
  })
})

test.describe('2つ目のタブ', () => {
  test('書き込みの権利を持つタブがあるとき、別のタブは読み取り専用の警告を出し、保存先を変えられない', async ({
    page,
    context,
  }) => {
    await stubFolderPicker(page)
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    const second = await context.newPage()
    await stubFolderPicker(second)
    await second.goto('/')
    await expect(second.getByRole('alert')).toContainText('別のタブでこのアプリを開いています')

    await openFromNav(second, '設定')
    await expect(storageRegion(second).getByRole('button', { name: 'フォルダを選ぶ…' })).toBeDisabled()

    // 最初のタブには警告が出ない
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

test.describe('フォルダ選択に非対応の環境', () => {
  test('選択肢を無効にし、理由とバックアップの案内を表示する', async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'showDirectoryPicker')
    })
    await page.goto('/')
    await openFromNav(page, '設定')

    await expect(storageRegion(page).getByRole('button', { name: 'フォルダを選ぶ…' })).toBeDisabled()
    await expect(storageRegion(page)).toContainText('お使いのブラウザは、フォルダへの保存に対応していません')
    await expect(storageRegion(page)).toContainText('バックアップ')
  })
})
