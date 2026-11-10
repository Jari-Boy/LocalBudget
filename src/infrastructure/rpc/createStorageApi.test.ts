/**
 * createStorageApi のテスト(計画Issue #174)。設定画面が使う「保存先の切り替え」のWorker側API。
 * フォルダへ移す(今のデータを書き込む/フォルダのファイルを開く)、ブラウザ内へ戻す(フォルダの
 * 最新データをコピーする/ブラウザ内の古いデータをそのまま使う)の各操作で、自動保存の
 * flush → stop、データの書き込み、ハンドルと保存先の選択の永続化が正しい順序で行われること、
 * 検証や保存に失敗したら保存先の選択を変えないこと、書き込みの権利が無いタブでは何もせず
 * 拒否することを検証する。成功後のページ再読み込みは呼び出し元(メインスレッド)の責務。
 * 外部依存: sql.js。ブラウザ用のcreateBrowserDatabaseはNode版に差し替える(スキーマ検証は本物)。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it, vi } from 'vitest'
import { InvalidBackupFileError } from '../backup/InvalidBackupFileError'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { ReadOnlyStorageError } from '../storage/ReadOnlyStorageError'
import type { StorageAdapter } from '../storage/StorageAdapter'
import type { StorageConfig } from '../storage/storageConfig'
import type { AutoSaveController } from '../storage/withAutoSave'
import { createStorageApi, type StorageStatus } from './createStorageApi'

vi.mock('../db/createBrowserDatabase', () => ({
  async createBrowserDatabase(initialData?: Uint8Array) {
    const require = createRequire(import.meta.url)
    const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    const wasmBinary = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength) as ArrayBuffer
    const SQL = await initSqlJs({ wasmBinary })
    return new SQL.Database(initialData)
  },
}))

async function setup(options: {
  status?: Partial<StorageStatus>
  folderFile?: Uint8Array | null
  folderSaveError?: Error
  indexedDbSaveError?: Error
  saveHandleError?: Error
  saveConfigError?: Error
} = {}) {
  const db = await createTestDatabase()
  runMigrations(db)
  const calls: string[] = []
  const folderSaved: Uint8Array[] = []
  const indexedDbSaved: Uint8Array[] = []
  const savedConfigs: StorageConfig[] = []
  const savedHandles: FileSystemDirectoryHandle[] = []

  const autoSave: AutoSaveController = {
    flush: async () => {
      calls.push('flush')
    },
    stop: async () => {
      calls.push('stop')
    },
    resume: () => {
      calls.push('resume')
    },
    hasExternalChange: () => false,
    getLastSaveError: () => null,
  }
  const folderAdapter: StorageAdapter = {
    load: async () => options.folderFile ?? null,
    save: async (data) => {
      calls.push('folder.save')
      if (options.folderSaveError) throw options.folderSaveError
      folderSaved.push(data)
    },
  }
  const indexedDbAdapter: StorageAdapter = {
    load: async () => null,
    save: async (data) => {
      calls.push('indexedDb.save')
      if (options.indexedDbSaveError) throw options.indexedDbSaveError
      indexedDbSaved.push(data)
    },
  }
  const folder = { name: '家計簿' } as FileSystemDirectoryHandle
  const api = createStorageApi({
    db,
    autoSave,
    status: { kind: 'indexeddb', folderName: null, writable: true, ...options.status },
    createFolderAdapter: () => folderAdapter,
    indexedDbAdapter,
    saveFolderHandle: async (handle) => {
      calls.push('saveHandle')
      if (options.saveHandleError) throw options.saveHandleError
      savedHandles.push(handle)
    },
    saveConfig: async (config) => {
      calls.push(`saveConfig:${config.kind}`)
      if (options.saveConfigError) throw options.saveConfigError
      savedConfigs.push(config)
    },
  })
  return { api, db, calls, folder, folderSaved, indexedDbSaved, savedConfigs, savedHandles }
}

describe('createStorageApi', () => {
  it('getStatus()は起動時に決まった保存先の状態を返す', async () => {
    const { api } = await setup({ status: { kind: 'folder', folderName: '家計簿', writable: false } })
    expect(api.getStatus()).toEqual({ kind: 'folder', folderName: '家計簿', writable: false })
  })

  describe('moveToFolder(copy): 今のデータをフォルダへ移す', () => {
    it('flush → stop → フォルダへ今のDBを保存 → ハンドル保存 → 保存先の選択の順に行う', async () => {
      const { api, calls, db, folder, folderSaved, savedHandles, savedConfigs } = await setup()

      await api.moveToFolder(folder, 'copy')

      expect(calls).toEqual(['flush', 'stop', 'folder.save', 'saveHandle', 'saveConfig:folder'])
      expect(folderSaved[0]).toEqual(db.export())
      expect(savedHandles).toEqual([folder])
      expect(savedConfigs).toEqual([{ kind: 'folder' }])
    })

    it('フォルダへの保存が失敗したら、ハンドルも保存先の選択も変えずにエラーを伝える', async () => {
      const { api, calls, folder } = await setup({ folderSaveError: new Error('disk full') })

      await expect(api.moveToFolder(folder, 'copy')).rejects.toThrow('disk full')

      expect(calls).not.toContain('saveHandle')
      expect(calls).not.toContain('saveConfig:folder')
    })

    it('フォルダへの保存が失敗したら、止めた自動保存を再開する(ページは再読み込みされず、元の保存先で編集が続くため)', async () => {
      const { api, calls, folder } = await setup({ folderSaveError: new Error('disk full') })

      await expect(api.moveToFolder(folder, 'copy')).rejects.toThrow('disk full')

      expect(calls).toEqual(['flush', 'stop', 'folder.save', 'resume'])
    })

    it('ハンドルの保存が失敗しても、自動保存を再開し、保存先の選択は変えない', async () => {
      const { api, calls, folder } = await setup({ saveHandleError: new Error('idb failed') })

      await expect(api.moveToFolder(folder, 'copy')).rejects.toThrow('idb failed')

      expect(calls).toEqual(['flush', 'stop', 'folder.save', 'saveHandle', 'resume'])
    })

    it('保存先の選択の保存が失敗しても、自動保存を再開する', async () => {
      const { api, calls, folder } = await setup({ saveConfigError: new Error('idb failed') })

      await expect(api.moveToFolder(folder, 'copy')).rejects.toThrow('idb failed')

      expect(calls.at(-1)).toBe('resume')
    })

    it('成功したときは自動保存を再開しない(再読み込みで新しい保存先から起動し直すため)', async () => {
      const { api, calls, folder } = await setup()

      await api.moveToFolder(folder, 'copy')

      expect(calls).not.toContain('resume')
    })
  })

  describe('moveToFolder(open): フォルダのファイルを開く', () => {
    it('有効なファイルなら、フォルダには書き込まず flush → stop → ハンドル保存 → 保存先の選択を行う', async () => {
      const source = await createTestDatabase()
      runMigrations(source)
      const { api, calls, folder, folderSaved } = await setup({ folderFile: source.export() })

      await api.moveToFolder(folder, 'open')

      expect(calls).toEqual(['flush', 'stop', 'saveHandle', 'saveConfig:folder'])
      expect(folderSaved).toEqual([])
    })

    it('LocalBudgetのDBでないファイルならInvalidBackupFileErrorを投げ、何も変えない', async () => {
      const unrelated = await createTestDatabase()
      const { api, calls, folder } = await setup({ folderFile: unrelated.export() })

      await expect(api.moveToFolder(folder, 'open')).rejects.toBeInstanceOf(InvalidBackupFileError)

      expect(calls).toEqual([])
    })

    it('ファイルが無ければInvalidBackupFileErrorを投げ、何も変えない', async () => {
      const { api, calls, folder } = await setup({ folderFile: null })

      await expect(api.moveToFolder(folder, 'open')).rejects.toBeInstanceOf(InvalidBackupFileError)

      expect(calls).toEqual([])
    })
  })

  describe('moveToIndexedDb', () => {
    it('copy: flush → stop → ブラウザ内へ今のDBを保存 → 保存先の選択の順に行う', async () => {
      const { api, calls, db, indexedDbSaved } = await setup({
        status: { kind: 'folder', folderName: '家計簿' },
      })

      await api.moveToIndexedDb('copy')

      expect(calls).toEqual(['flush', 'stop', 'indexedDb.save', 'saveConfig:indexeddb'])
      expect(indexedDbSaved[0]).toEqual(db.export())
    })

    it('keep: ブラウザ内には書き込まず、flush → stop → 保存先の選択だけを行う', async () => {
      const { api, calls, indexedDbSaved } = await setup({
        status: { kind: 'folder', folderName: '家計簿' },
      })

      await api.moveToIndexedDb('keep')

      expect(calls).toEqual(['flush', 'stop', 'saveConfig:indexeddb'])
      expect(indexedDbSaved).toEqual([])
    })

    it('ブラウザ内への書き込みが失敗したら、自動保存を再開し、保存先の選択は変えない', async () => {
      const { api, calls } = await setup({
        status: { kind: 'folder', folderName: '家計簿' },
        indexedDbSaveError: new Error('quota exceeded'),
      })

      await expect(api.moveToIndexedDb('copy')).rejects.toThrow('quota exceeded')

      expect(calls).toEqual(['flush', 'stop', 'indexedDb.save', 'resume'])
    })

    it('keepで保存先の選択の保存が失敗したら、自動保存を再開する', async () => {
      const { api, calls } = await setup({
        status: { kind: 'folder', folderName: '家計簿' },
        saveConfigError: new Error('idb failed'),
      })

      await expect(api.moveToIndexedDb('keep')).rejects.toThrow('idb failed')

      expect(calls).toEqual(['flush', 'stop', 'saveConfig:indexeddb', 'resume'])
    })

    it('成功したときは自動保存を再開しない', async () => {
      const { api, calls } = await setup({ status: { kind: 'folder', folderName: '家計簿' } })

      await api.moveToIndexedDb('copy')

      expect(calls).not.toContain('resume')
    })
  })

  it('書き込みの権利が無いタブでは、どの操作もReadOnlyStorageErrorで拒否し何も呼ばない', async () => {
    const { api, calls, folder } = await setup({ status: { writable: false } })

    await expect(api.moveToFolder(folder, 'copy')).rejects.toBeInstanceOf(ReadOnlyStorageError)
    await expect(api.moveToFolder(folder, 'open')).rejects.toBeInstanceOf(ReadOnlyStorageError)
    await expect(api.moveToIndexedDb('copy')).rejects.toBeInstanceOf(ReadOnlyStorageError)

    expect(calls).toEqual([])
  })
})
