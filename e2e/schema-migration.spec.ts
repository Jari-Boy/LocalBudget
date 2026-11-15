/**
 * 差分マイグレーションの起動フロー(計画Issue #42)のE2Eテスト。実ブラウザ(Chromium)の
 * Web Worker・IndexedDB・WASMで、保存データが新しいバージョン(user_versionが最新より大きい)のときの
 * 起動を検証する。開かずに案内画面を出し、元のデータを書き出せ、保存先のデータは変わらない。
 * 差分の適用・失敗・移行前バックアップは、本番前(凍結前)は実際の差分が無いため、
 * ユニットテスト(migrations.plan.test.ts、openMigratedDatabase.test.ts)で検証する。
 * DBの準備は、アプリ(Worker)を起動しない /favicon.svg のページからIndexedDBへ直接書き込む
 * (アプリが動いていると、ページ非表示時の自動保存が書き込んだDBを上書きするため)。
 */
import { expect, test, type Page } from '@playwright/test'

/** 最新より新しいバージョンのDBを作ってIndexedDBの本体のキーに保存し、保存したバイト列を返す */
async function seedTooNewDatabase(page: Page): Promise<number[]> {
  await page.goto('/favicon.svg')
  return page.evaluate(async () => {
    const { createBrowserDatabase } = await import('/src/infrastructure/db/createBrowserDatabase.ts')
    const { LATEST_SCHEMA_VERSION, runMigrations } = await import('/src/infrastructure/db/migrations.ts')
    const { IndexedDBStorageAdapter } = await import('/src/infrastructure/storage/IndexedDBStorageAdapter.ts')

    const db = await createBrowserDatabase()
    runMigrations(db)
    db.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    const bytes = db.export()
    await new IndexedDBStorageAdapter().save(bytes)
    return Array.from(bytes)
  })
}

test.describe('差分マイグレーションの起動フロー', () => {
  test('新しいバージョンのデータは開かずに案内を出し、元のデータを書き出せる', async ({ page }) => {
    const original = await seedTooNewDatabase(page)

    await page.goto('/')

    await expect(page.getByRole('heading', { name: '新しいバージョンのアプリで保存されたデータです' })).toBeVisible()
    await page.screenshot({ path: 'test-results/startup-error-too-new.png' })
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'データを書き出す' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^local-budget-backup-\d{8}-\d{4}\.sqlite$/)

    // 保存先のデータは変わらない
    const saved = await page.evaluate(async () => {
      const { IndexedDBStorageAdapter } = await import('/src/infrastructure/storage/IndexedDBStorageAdapter.ts')
      const bytes = await new IndexedDBStorageAdapter().load()
      return bytes === null ? null : Array.from(bytes)
    })
    expect(saved).toEqual(original)
  })
})
