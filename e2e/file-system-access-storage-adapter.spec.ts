/**
 * FileSystemAccessStorageAdapter(計画Issue #57)のE2Eテスト。File System Access API
 * (showDirectoryPicker, FileSystemDirectoryHandleのIndexedDB永続化、queryPermission/
 * requestPermissionによる権限再確認)はNode/jsdom環境に実装がなく再現できないため、
 * 実ブラウザ(Chromium)でPlaywrightを用いて検証する(docs/architecture.md 10章)。
 *
 * `showDirectoryPicker`は実際のOSダイアログを開きユーザー操作を要求するため、
 * Playwrightから直接自動操作できない。このテストでは`window.showDirectoryPicker`を
 * Origin Private File System(`navigator.storage.getDirectory()`)が返す本物の
 * `FileSystemDirectoryHandle`を返すモックに差し替える。OPFS由来のハンドルも通常の
 * ローカルディスクのハンドルと同じ`FileSystemDirectoryHandle`インターフェース
 * (structured clone対応・getFileHandle・queryPermission等)を実装しているため、
 * ディレクトリ選択以外の挙動(IndexedDBへの永続化・ファイル読み書き・権限確認)は
 * すべて実ブラウザのネイティブ実装で検証できる。
 */
import { test, expect } from '@playwright/test'

test.describe('FileSystemAccessStorageAdapter', () => {
  test('showDirectoryPicker非対応環境ではFileSystemAccessNotSupportedErrorを投げる', async ({
    page,
  }) => {
    await page.goto('/')

    const errorName = await page.evaluate(async () => {
      Reflect.deleteProperty(window, 'showDirectoryPicker')
      const { FileSystemAccessStorageAdapter } = await import(
        '/src/infrastructure/storage/FileSystemAccessStorageAdapter.ts'
      )
      try {
        new FileSystemAccessStorageAdapter()
        return null
      } catch (error) {
        return (error as Error).name
      }
    })

    expect(errorName).toBe('FileSystemAccessNotSupportedError')
  })

  test('ディレクトリ選択後、save()で保存したバイト列をload()で読み出せる(往復)', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      window.showDirectoryPicker = async () => navigator.storage.getDirectory()

      const { FileSystemAccessStorageAdapter } = await import(
        '/src/infrastructure/storage/FileSystemAccessStorageAdapter.ts'
      )
      const adapter = new FileSystemAccessStorageAdapter()
      await adapter.selectNewDirectory()
      await adapter.save(new Uint8Array([1, 2, 3, 4, 5]))
      const loaded = await adapter.load()
      return loaded ? Array.from(loaded) : null
    })

    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  test('ディレクトリ選択後、一度もsave()していない場合、load()はnullを返す', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      window.showDirectoryPicker = async () => navigator.storage.getDirectory()

      const { FileSystemAccessStorageAdapter } = await import(
        '/src/infrastructure/storage/FileSystemAccessStorageAdapter.ts'
      )
      const adapter = new FileSystemAccessStorageAdapter()
      await adapter.selectNewDirectory()
      return adapter.load()
    })

    expect(result).toBeNull()
  })

  test('ディレクトリ未選択の状態でload()/save()を呼ぶとエラーになる', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      window.showDirectoryPicker = async () => navigator.storage.getDirectory()

      const { FileSystemAccessStorageAdapter } = await import(
        '/src/infrastructure/storage/FileSystemAccessStorageAdapter.ts'
      )
      const adapter = new FileSystemAccessStorageAdapter()
      try {
        await adapter.load()
        return 'no error'
      } catch (error) {
        return (error as Error).message
      }
    })

    expect(result).toContain('directory has not been selected')
  })

  test('selectNewDirectory()で選択したディレクトリハンドルはIndexedDBに保存され、別インスタンスのrestoreDirectory()で復元して権限再確認フローを経て読み書きできる', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      window.showDirectoryPicker = async () => navigator.storage.getDirectory()

      // restoreDirectory()内でqueryPermissionが実際に呼ばれることを検証するため、
      // プロトタイプメソッドをスパイする(IndexedDBのstructured cloneを経由しても
      // プロトタイプ自体の差し替えは維持される)。
      let queryPermissionCallCount = 0
      const originalQueryPermission = FileSystemHandle.prototype.queryPermission
      FileSystemHandle.prototype.queryPermission = function (
        this: FileSystemHandle,
        ...args: Parameters<typeof originalQueryPermission>
      ) {
        queryPermissionCallCount += 1
        return originalQueryPermission.apply(this, args)
      }

      const { FileSystemAccessStorageAdapter } = await import(
        '/src/infrastructure/storage/FileSystemAccessStorageAdapter.ts'
      )
      const first = new FileSystemAccessStorageAdapter()
      await first.selectNewDirectory()
      await first.save(new Uint8Array([9, 8, 7]))

      // 次回起動をシミュレートする別インスタンス
      const second = new FileSystemAccessStorageAdapter()
      const restored = await second.restoreDirectory()
      const loaded = await second.load()

      return {
        restored,
        loaded: loaded ? Array.from(loaded) : null,
        queryPermissionCalled: queryPermissionCallCount > 0,
      }
    })

    expect(result).toEqual({ restored: true, loaded: [9, 8, 7], queryPermissionCalled: true })
  })

  test('ディレクトリ未選択の状態でrestoreDirectory()を呼ぶとfalseを返す', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      window.showDirectoryPicker = async () => navigator.storage.getDirectory()

      const { FileSystemAccessStorageAdapter } = await import(
        '/src/infrastructure/storage/FileSystemAccessStorageAdapter.ts'
      )
      const adapter = new FileSystemAccessStorageAdapter()
      return adapter.restoreDirectory()
    })

    expect(result).toBe(false)
  })
})
