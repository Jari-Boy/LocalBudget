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
 * 各テストが作成する科目名で全件一致(toEqual)を検証すると、CI環境の並列実行下で
 * IndexedDBのタイミング競合により他テストの科目が一時的に混入しflakyになることを実機で
 * 確認したため、「このテストが検証すべき対象科目の有無」(対象科目が存在する/取り消される
 * べき科目が存在しない)のみをtoContain/not.toContainで検証する形にしている。
 * また、seedDefaultAccounts(計画Issue #96)によりWorker起動時点でrevenue/expense区分の
 * 標準科目(食費・交通費等)が既に存在するため、作成する科目名はデフォルトシードのリスト
 * (defaultAccountSeedData.ts)と衝突しない名前を使う。
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
        await client.account.create({ category: 'expense', name: 'バックアップ対象科目', isReconcilable: null })
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
      const { toDatabaseBlob, fromDatabaseFile } = await import(
        '/src/infrastructure/storage/databaseFileCodec.ts'
      )
      const client = await createDbClient()

      await client.account.create({ category: 'expense', name: 'バックアップ対象科目', isReconcilable: null })
      const backup = await client.backup.export()

      // 実際のUI(別Issue)ではtoDatabaseBlobでダウンロードしたファイルをユーザーが選択し、
      // fromDatabaseFileで読み込む(計画Issue #26の目標3、既存databaseFileCodecの再利用)。
      // ここでも同じ変換を経由させて往復させる。
      const file = new File([toDatabaseBlob(backup)], 'local-budget-backup.sqlite')
      const restoredBytes = await fromDatabaseFile(file)

      // エクスポート後に別データを追加してから、エクスポート済みのバイト列をインポートし、
      // エクスポート時点の状態(バックアップ対象科目のみ)に戻ることを確認する
      await client.account.create({ category: 'expense', name: '一時科目', isReconcilable: null })
      await client.backup.importDatabase(restoredBytes)
    })

    await page.reload()

    const accountNames = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.map((account) => account.name)
    })

    expect(accountNames).toContain('バックアップ対象科目')
    expect(accountNames).not.toContain('一時科目')
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

      await client.account.create({ category: 'expense', name: 'バックアップ対象科目', isReconcilable: null })
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

    expect(accountNames).toContain('バックアップ対象科目')
  })

  test('マイグレーション未適用の空のDB(無関係なsql.jsファイル)をインポートしようとするとInvalidBackupFileErrorを投げ、既存データは保持される', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const { createBrowserDatabase } = await import(
        '/src/infrastructure/db/createBrowserDatabase.ts'
      )
      const { InvalidBackupFileError } = await import(
        '/src/infrastructure/backup/InvalidBackupFileError.ts'
      )
      const client = await createDbClient()

      await client.account.create({ category: 'expense', name: 'バックアップ対象科目', isReconcilable: null })
      await client.autoSave.flush()

      // runMigrationsを一切適用していない空のsql.js DB(PRAGMA user_version = 0)。
      // 検証(assertValidDatabaseSchema)よりも先にrunMigrationsを適用してしまうと、
      // このバイト列自体がLocalBudgetの全テーブルを持つ状態に変化し検証をすり抜けてしまう
      // ため、順序が正しいことを固定する回帰テスト。
      const emptyDb = await createBrowserDatabase()
      const emptyDbBytes = emptyDb.export()
      emptyDb.close()

      try {
        await client.backup.importDatabase(emptyDbBytes)
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

    expect(accountNames).toContain('バックアップ対象科目')
  })
})
