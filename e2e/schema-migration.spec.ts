/**
 * 差分マイグレーションの起動フロー(計画Issue #42)のE2Eテスト。実ブラウザ(Chromium)の
 * Web Worker・IndexedDB・WASMで、保存データのバージョンに応じた起動を検証する。
 * - 新しいバージョン(user_versionが最新より大きい)のDBは、開かずに案内画面を出し、元のデータを書き出せる
 * - 差分が失敗するDBは、起動を止めてエラー画面を出し、元のデータを書き出せる(DBは変更されない)
 * - 古いバージョンのDBは、移行前の元のバイト列がバックアップ(別キー)に残り、移行後のDBが直ちに保存される
 * DBの準備は、アプリ(Worker)を起動しない /favicon.svg のページからIndexedDBへ直接書き込む
 * (アプリが動いていると、ページ非表示時の自動保存が書き込んだDBを上書きするため)。
 */
import { expect, test, type Page } from '@playwright/test'

const SNAPSHOT_KEY = 'snapshot'
const BACKUP_KEY = 'pre-migration-backup'

type Scenario = 'too-new' | 'migration-fails' | 'version-1'

/** シナリオに応じたDBを作ってIndexedDBの本体のキーに保存し、保存したバイト列を返す */
async function seedDatabase(page: Page, scenario: Scenario): Promise<number[]> {
  await page.goto('/favicon.svg')
  return page.evaluate(async (scenarioName) => {
    const { createBrowserDatabase } = await import('/src/infrastructure/db/createBrowserDatabase.ts')
    const { LATEST_SCHEMA_VERSION, runMigrations } = await import('/src/infrastructure/db/migrations.ts')
    const { IndexedDBStorageAdapter } = await import('/src/infrastructure/storage/IndexedDBStorageAdapter.ts')

    const db = await createBrowserDatabase()
    runMigrations(db)
    if (scenarioName === 'too-new') {
      db.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    } else {
      // バージョン1(仕訳テンプレートの表が無い)のDBを再現する
      db.run('DROP TABLE journal_template_lines')
      db.run('DROP TABLE journal_templates')
      db.run('DROP TABLE journal_template_groups')
      db.run('PRAGMA user_version = 1')
      if (scenarioName === 'migration-fails') {
        // 差分(仕訳テンプレートの表の作成)が「表が既にある」で失敗するようにする
        db.run('CREATE TABLE journal_templates (id INTEGER PRIMARY KEY)')
      }
    }
    const bytes = db.export()
    await new IndexedDBStorageAdapter().save(bytes)
    return Array.from(bytes)
  }, scenario)
}

/** IndexedDBの指定キーのバイト列を読む(無ければnull)。 */
async function readRecord(page: Page, key: string): Promise<number[] | null> {
  return page.evaluate(
    (recordKey) =>
      new Promise<number[] | null>((resolve, reject) => {
        const open = indexedDB.open('local-budget', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const request = open.result.transaction('sqlite-snapshot', 'readonly').objectStore('sqlite-snapshot').get(recordKey)
          request.onsuccess = () => resolve(request.result ? Array.from(request.result as Uint8Array) : null)
          request.onerror = () => reject(request.error)
        }
      }),
    key,
  )
}

/** SQLiteファイルのヘッダ(60〜63バイト目、ビッグエンディアン)のuser_version */
function userVersionOf(bytes: number[]): number {
  return ((bytes[60] << 24) | (bytes[61] << 16) | (bytes[62] << 8) | bytes[63]) >>> 0
}

test.describe('差分マイグレーションの起動フロー', () => {
  test('新しいバージョンのデータは開かずに案内を出し、元のデータを書き出せる', async ({ page }) => {
    const original = await seedDatabase(page, 'too-new')

    await page.goto('/')

    await expect(page.getByRole('heading', { name: '新しいバージョンのアプリで保存されたデータです' })).toBeVisible()
    await page.screenshot({ path: 'test-results/startup-error-too-new.png' })
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'データを書き出す' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^local-budget-backup-\d{8}-\d{4}\.sqlite$/)
    // 保存先のデータは変わらない
    expect(await readRecord(page, SNAPSHOT_KEY)).toEqual(original)
  })

  test('差分が失敗するデータは、起動を止めてエラー画面を出し、DBは変更しない', async ({ page }) => {
    const original = await seedDatabase(page, 'migration-fails')

    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'データを新しい形式に更新できませんでした' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('already exists')
    await page.screenshot({ path: 'test-results/startup-error-migration-failed.png' })
    await expect(page.getByRole('button', { name: '元のデータを書き出す' })).toBeVisible()
    expect(await readRecord(page, SNAPSHOT_KEY)).toEqual(original)
  })

  test('古いバージョンのデータは、移行前のバイト列がバックアップに残り、移行後のDBが直ちに保存される', async ({ page }) => {
    const original = await seedDatabase(page, 'version-1')
    expect(userVersionOf(original)).toBe(1)

    await page.goto('/')

    // 移行は起動中に行われ、成功後すぐに保存される(自動保存のデバウンスを待たない)
    await expect
      .poll(
        async () => {
          const saved = await readRecord(page, SNAPSHOT_KEY)
          return saved === null ? null : userVersionOf(saved)
        },
        // 開発サーバーの初回変換とWASMの読み込みに時間がかかるため、長めに待つ
        { timeout: 30_000 },
      )
      .toBe(2)
    expect(await readRecord(page, BACKUP_KEY)).toEqual(original)
  })
})
