/**
 * バックアップExport/Import機能(計画Issue #26)のE2Eテスト。
 * DB全体のシリアライズ結果をBlobとしてダウンロードするエクスポート、アップロードされた
 * バイト列でDBを丸ごと置き換えるインポート(検証→StorageAdapterへ保存→呼び出し元による
 * ページリロード、docs/architecture.md 8章)を実ブラウザ(Chromium)で検証する。
 * UIエントリポイント(設定画面等の配置)は別Issueのスコープのため、worker-rpc.spec.tsと
 * 同じ方針でRPCクライアント(backup.export/backup.importDatabase)・downloadDatabaseBackupを
 * ページ上で直接呼び出す形で検証する。withAutoSaveの永続化はtrailing debounce(計画Issue #58)
 * のため、リロードを挟む前は`client.autoSave.flush()`で確実にIndexedDBへ反映させてから
 * 次の検証に進む(storage-adapter-boot-restore.spec.tsと同じ配慮)。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし)。
 */
import { test, expect } from '@playwright/test'

test.describe('バックアップExport/Import', () => {
  test('エクスポートしたバイト列をBlobダウンロードとして取得できる', async ({ page }) => {
    await page.goto('/')

    const [download, exportedSize] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(async () => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const { downloadDatabaseBackup } = await import(
          '/src/infrastructure/backup/downloadDatabaseBackup.ts'
        )
        const client = await createDbClient()
        await client.account.create({ category: 'expense', name: '食費', isReconcilable: null })
        const data = await client.backup.export()
        downloadDatabaseBackup(data, 'local-budget-backup.sqlite')
        return data.length
      }),
    ])

    expect(download.suggestedFilename()).toBe('local-budget-backup.sqlite')
    expect(exportedSize).toBeGreaterThan(0)
  })

  test('エクスポート→インポートの往復でエクスポート時点のデータに復元される(リロード後に反映)', async ({
    page,
  }) => {
    await page.goto('/')

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()

      await client.account.create({ category: 'expense', name: '食費', isReconcilable: null })
      const backup = await client.backup.export()

      // エクスポート後に別データを追加してから、エクスポート済みのバイト列をインポートし、
      // エクスポート時点の状態(食費のみ)に戻ることを確認する
      await client.account.create({ category: 'expense', name: '交通費', isReconcilable: null })
      await client.backup.importDatabase(backup)
    })

    await page.reload()

    const accountNames = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.map((account) => account.name)
    })

    expect(accountNames).toEqual(['食費'])
  })

  test('不正なファイルをインポートしようとするとInvalidBackupFileErrorが投げられ、既存データは保持される', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const { InvalidBackupFileError } = await import(
        '/src/infrastructure/backup/InvalidBackupFileError.ts'
      )
      const client = await createDbClient()

      await client.account.create({ category: 'expense', name: '食費', isReconcilable: null })
      // リロード後の検証まで確実にIndexedDBへ反映させておく(trailing debounce待ちにしない)
      await client.autoSave.flush()

      const garbage = new TextEncoder().encode('this is not a sqlite database file')
      try {
        await client.backup.importDatabase(garbage)
        return { threw: false, isInvalidBackupFileError: false }
      } catch (error) {
        return { threw: true, isInvalidBackupFileError: error instanceof InvalidBackupFileError }
      }
    })

    expect(result).toEqual({ threw: true, isInvalidBackupFileError: true })

    await page.reload()

    const accountNames = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.map((account) => account.name)
    })

    expect(accountNames).toEqual(['食費'])
  })
})
