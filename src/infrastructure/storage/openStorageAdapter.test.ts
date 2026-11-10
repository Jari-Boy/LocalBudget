/**
 * openStorageAdapter のユニットテスト(計画Issue #174)。Worker起動時に、保存された保存先の選択
 * (ブラウザ内/フォルダ)に応じたStorageAdapterを用意する。フォルダのときは、メインスレッドで
 * 権限を確認済みのハンドルを使う。ハンドルが無い・権限が「granted」でないときは、DBを開かずに
 * FolderNotConnectedErrorを投げる(権限の再要求にはユーザー操作が必要でWorkerからはできないため。
 * 通常はメインスレッドの再接続画面が先に止めるので、これは取りこぼしへの最後の防御)。
 * 外部依存: なし。ハンドルは偽物を渡す。
 */
import { describe, expect, it } from 'vitest'
import { FolderNotConnectedError } from './FolderNotConnectedError'
import { openStorageAdapter, type OpenStorageAdapterDeps } from './openStorageAdapter'
import type { StorageAdapter } from './StorageAdapter'

const indexedDbAdapter: StorageAdapter = { load: async () => null, save: async () => {} }
const folderAdapter: StorageAdapter = { load: async () => null, save: async () => {} }

function handleWith(permission: PermissionState): FileSystemDirectoryHandle {
  return { name: '家計簿', queryPermission: async () => permission } as unknown as FileSystemDirectoryHandle
}

function deps(overrides: Partial<OpenStorageAdapterDeps> = {}): OpenStorageAdapterDeps {
  return {
    loadConfig: async () => ({ kind: 'indexeddb' }),
    loadFolderHandle: async () => null,
    createIndexedDbAdapter: () => indexedDbAdapter,
    createFolderAdapter: () => folderAdapter,
    ...overrides,
  }
}

describe('openStorageAdapter', () => {
  it('ブラウザ内の選択ならIndexedDBのアダプタを返し、フォルダ名はnull', async () => {
    const opened = await openStorageAdapter(deps())
    expect(opened).toEqual({ kind: 'indexeddb', adapter: indexedDbAdapter, folderName: null })
  })

  it('フォルダの選択で権限がgrantedなら、フォルダのアダプタとフォルダ名を返す', async () => {
    const opened = await openStorageAdapter(
      deps({
        loadConfig: async () => ({ kind: 'folder' }),
        loadFolderHandle: async () => handleWith('granted'),
      }),
    )
    expect(opened).toEqual({ kind: 'folder', adapter: folderAdapter, folderName: '家計簿' })
  })

  it('フォルダの選択でハンドルが無ければFolderNotConnectedErrorを投げる', async () => {
    await expect(openStorageAdapter(deps({ loadConfig: async () => ({ kind: 'folder' }) }))).rejects.toBeInstanceOf(
      FolderNotConnectedError,
    )
  })

  it('フォルダの選択で権限がgrantedでなければFolderNotConnectedErrorを投げる', async () => {
    await expect(
      openStorageAdapter(
        deps({
          loadConfig: async () => ({ kind: 'folder' }),
          loadFolderHandle: async () => handleWith('prompt'),
        }),
      ),
    ).rejects.toBeInstanceOf(FolderNotConnectedError)
  })
})
