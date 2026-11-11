/**
 * FileSystemAccessStorageAdapter の外部変更検知のユニットテスト(計画Issue #175)。ファイルの読み込み時・
 * 保存時の更新日時とサイズを記録し、保存の直前にフォルダのファイルが外部(別の端末の同期クライアント等)で
 * 変わっていたら、上書きせずExternalChangeErrorで保存を止めること、自分自身の直前の保存による変化は
 * 外部変更と誤検知しないことを検証する。
 * 外部依存: なし。FileSystemDirectoryHandle/FileSystemFileHandleはメモリ上の偽物で、書き込みの完了(close)で
 * 更新日時が進む。IndexedDBは使わない(ハンドルは fromDirectoryHandle で直接渡す)。実ブラウザでの動作は
 * Playwrightで検証する(e2e/folder-storage.spec.ts)。
 */
import { describe, expect, it } from 'vitest'
import { ExternalChangeError } from './ExternalChangeError'
import { FileSystemAccessStorageAdapter } from './FileSystemAccessStorageAdapter'

const FILE_NAME = 'local-budget.sqlite'

/** メモリ上のフォルダ。ファイルの内容と更新日時を持ち、外部の変更(externalWrite)も再現できる。 */
function createFakeFolder(initial?: Uint8Array) {
  let data: Uint8Array | null = initial ?? null
  let lastModified = 1000
  let writeCount = 0
  let failGetFileAfterWrite = false

  const fileHandle = {
    async getFile() {
      if (failGetFileAfterWrite && writeCount > 0) throw new DOMException('transient', 'NotReadableError')
      const bytes = data as Uint8Array
      return {
        lastModified,
        size: bytes.byteLength,
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        },
      }
    },
    async createWritable() {
      let pending: Uint8Array | null = null
      return {
        async write(blob: Blob) {
          pending = new Uint8Array(await blob.arrayBuffer())
        },
        async close() {
          data = pending
          lastModified += 10
          writeCount += 1
        },
        async abort() {},
      }
    },
  }
  const directoryHandle = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (name !== FILE_NAME) throw new Error('unexpected file name')
      if (data === null) {
        if (!options?.create) throw new DOMException('not found', 'NotFoundError')
        data = new Uint8Array()
      }
      return fileHandle
    },
  } as unknown as FileSystemDirectoryHandle

  return {
    directoryHandle,
    get content() {
      return data
    },
    get writeCount() {
      return writeCount
    },
    /** 別の端末の同期クライアントによるファイルの置き換え。内容・日時を指定できる。 */
    externalWrite(bytes: Uint8Array, options: { keepLastModified?: boolean } = {}) {
      data = bytes
      if (!options.keepLastModified) lastModified += 500
    },
    /** 書き込みの後の getFile() を失敗させる(同期クライアントがファイルを掴んでいる状況など)。 */
    failGetFileAfterWrite(value: boolean) {
      failGetFileAfterWrite = value
    },
    externalDelete() {
      data = null
    },
  }
}

const bytes = (...values: number[]) => new Uint8Array(values)

describe('FileSystemAccessStorageAdapter の外部変更検知', () => {
  it('読み込み後にファイルが外部で更新されていたら、保存せずExternalChangeErrorで止める', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()

    folder.externalWrite(bytes(9, 9, 9))

    await expect(adapter.save(bytes(4, 5, 6))).rejects.toBeInstanceOf(ExternalChangeError)
    expect(folder.writeCount).toBe(0)
    expect(Array.from(folder.content as Uint8Array)).toEqual([9, 9, 9])
  })

  it('更新日時が同じでもサイズが変わっていれば外部変更として検知する', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()

    folder.externalWrite(bytes(1, 2, 3, 4), { keepLastModified: true })

    await expect(adapter.save(bytes(7))).rejects.toBeInstanceOf(ExternalChangeError)
  })

  it('読み込み後に外部の変更がなければ保存できる', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()

    await adapter.save(bytes(4, 5, 6))

    expect(Array.from(folder.content as Uint8Array)).toEqual([4, 5, 6])
  })

  it('自分自身の直前の保存による更新日時の変化を、外部変更と誤検知しない(連続して保存できる)', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()

    await adapter.save(bytes(4))
    await adapter.save(bytes(5, 6))

    expect(folder.writeCount).toBe(2)
    expect(Array.from(folder.content as Uint8Array)).toEqual([5, 6])
  })

  it('自分の保存の後にファイルが外部で更新されたら、次の保存を止める', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()
    await adapter.save(bytes(4))

    folder.externalWrite(bytes(8, 8))

    await expect(adapter.save(bytes(5))).rejects.toBeInstanceOf(ExternalChangeError)
    expect(folder.writeCount).toBe(1)
  })

  it('読み込み時にファイルがなかったのに、保存前に外部でファイルが作られていたら止める', async () => {
    const folder = createFakeFolder()
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    expect(await adapter.load()).toBeNull()

    folder.externalWrite(bytes(7, 7))

    await expect(adapter.save(bytes(1))).rejects.toBeInstanceOf(ExternalChangeError)
    expect(Array.from(folder.content as Uint8Array)).toEqual([7, 7])
  })

  it('読み込んだファイルが保存前に外部で削除されていたら止める', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()

    folder.externalDelete()

    await expect(adapter.save(bytes(1))).rejects.toBeInstanceOf(ExternalChangeError)
    expect(folder.content).toBeNull()
  })

  it('読み込み前の保存(保存先の切り替えでの上書き)は、既存ファイルがあっても検知せず書き込む', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)

    await adapter.save(bytes(9))

    expect(Array.from(folder.content as Uint8Array)).toEqual([9])
  })

  it('読み込み前に新規ファイルを作って保存した後は、続く保存を自分の更新として扱う', async () => {
    const folder = createFakeFolder()
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)

    await adapter.save(bytes(1))
    await adapter.save(bytes(2))

    expect(folder.writeCount).toBe(2)
  })
  it('書き込みは成功したが直後の getFile() が失敗した場合も、保存は成功として扱い、次の保存を外部変更と誤検知して止めない', async () => {
    const folder = createFakeFolder(bytes(1, 2, 3))
    const adapter = FileSystemAccessStorageAdapter.fromDirectoryHandle(folder.directoryHandle)
    await adapter.load()
    folder.failGetFileAfterWrite(true)

    await adapter.save(bytes(4))
    folder.failGetFileAfterWrite(false)
    await adapter.save(bytes(5))

    expect(Array.from(folder.content as Uint8Array)).toEqual([5])
  })
})
