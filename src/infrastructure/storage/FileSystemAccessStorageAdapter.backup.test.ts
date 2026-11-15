/**
 * FileSystemAccessStorageAdapter.savePreMigrationBackup のユニットテスト(計画Issue #42)。
 * マイグレーションを流す前の元のDBを、同じフォルダの別ファイル(local-budget.pre-migration-backup.sqlite)へ保存する。
 * 本体のファイルには触れず、2回目以降は同じファイルを上書きする(直近の1つだけ残る)。
 * 外部依存: なし。FileSystemDirectoryHandleはメモリ上の偽物(ファイル名ごとの内容を持つ)。
 */
import { describe, expect, it } from 'vitest'
import { FileSystemAccessStorageAdapter } from './FileSystemAccessStorageAdapter'

function createFakeFolder() {
  const files = new Map<string, Uint8Array>()
  const directoryHandle = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('not found', 'NotFoundError')
        files.set(name, new Uint8Array())
      }
      return {
        async getFile() {
          const bytes = files.get(name) as Uint8Array
          return { lastModified: 1, size: bytes.byteLength, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }
        },
        async createWritable() {
          let pending: Uint8Array | null = null
          return {
            async write(blob: Blob) {
              pending = new Uint8Array(await blob.arrayBuffer())
            },
            async close() {
              files.set(name, pending as Uint8Array)
            },
            async abort() {},
          }
        },
      }
    },
  } as unknown as FileSystemDirectoryHandle
  return { directoryHandle, files }
}

describe('FileSystemAccessStorageAdapter.savePreMigrationBackup', () => {
  it('同じフォルダの別ファイルにバイト列を保存し、本体のファイルは作らない・変えない', async () => {
    const folder = createFakeFolder()
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)

    await adapter.savePreMigrationBackup(new Uint8Array([1, 2, 3]))

    expect([...folder.files.keys()]).toEqual(['local-budget.pre-migration-backup.sqlite'])
    expect(folder.files.get('local-budget.pre-migration-backup.sqlite')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('2回目の保存は同じファイルを上書きする(直近の1つだけ残る)', async () => {
    const folder = createFakeFolder()
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)

    await adapter.savePreMigrationBackup(new Uint8Array([1]))
    await adapter.savePreMigrationBackup(new Uint8Array([9, 9]))

    expect(folder.files.size).toBe(1)
    expect(folder.files.get('local-budget.pre-migration-backup.sqlite')).toEqual(new Uint8Array([9, 9]))
  })
})
