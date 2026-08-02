/**
 * databaseFileCodec のユニットテスト。DBバイト列(sql.jsのUint8Array)とファイルI/O
 * (Blob/File/FileSystemFileHandle)間の変換ロジックを検証する。このロジックは
 * FileSystemAccessStorageAdapterと将来のExport/Import機能(#26)で共通化する
 * (docs/architecture.md 8章、計画Issue #57 目標3)。FileSystemFileHandleはNode環境に
 * 実装がないため、createWritable/getFileを持つ最小限のモックオブジェクトで代替する。
 * 外部依存: なし(Blob/FileはNode標準グローバル)。
 */
import { describe, expect, it } from 'vitest'
import {
  fromDatabaseFile,
  readDatabaseFromFileHandle,
  toDatabaseBlob,
  writeDatabaseToFileHandle,
} from './databaseFileCodec'

/** FileSystemWritableFileStreamの最小限のモック。write()した内容をchunksに記録する。 */
function createRecordingWritable(): FileSystemWritableFileStream & { chunks: BlobPart[] } {
  const chunks: BlobPart[] = []
  return {
    chunks,
    async write(data: FileSystemWriteChunkType) {
      chunks.push(data as BlobPart)
    },
    async close() {},
    async abort() {},
    async seek() {},
    async truncate() {},
    locked: false,
    getWriter: () => {
      throw new Error('not implemented')
    },
  } as unknown as FileSystemWritableFileStream & { chunks: BlobPart[] }
}

/** FileSystemFileHandleの最小限のモック。createWritable()はwrite内容を記録し、getFile()は保持しているBlobをFile化して返す。 */
function createRecordingFileHandle(initialData?: Uint8Array): FileSystemFileHandle & {
  writable: ReturnType<typeof createRecordingWritable>
} {
  const writable = createRecordingWritable()
  return {
    writable,
    kind: 'file',
    name: 'local-budget.sqlite',
    async createWritable() {
      return writable
    },
    async getFile() {
      return new File(initialData ? [initialData as Uint8Array<ArrayBuffer>] : [], 'local-budget.sqlite')
    },
  } as unknown as FileSystemFileHandle & { writable: ReturnType<typeof createRecordingWritable> }
}

describe('toDatabaseBlob', () => {
  it('Uint8ArrayをBlobに変換する', async () => {
    const data = new Uint8Array([1, 2, 3])

    const blob = toDatabaseBlob(data)

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data)
  })
})

describe('fromDatabaseFile', () => {
  it('FileをUint8Arrayに変換する', async () => {
    const data = new Uint8Array([4, 5, 6])
    const file = new File([data], 'local-budget.sqlite')

    const result = await fromDatabaseFile(file)

    expect(result).toEqual(data)
  })
})

describe('writeDatabaseToFileHandle', () => {
  it('FileSystemWritableFileStreamへ書き込んでclose()する', async () => {
    const fileHandle = createRecordingFileHandle()
    const data = new Uint8Array([7, 8, 9])

    await writeDatabaseToFileHandle(fileHandle, data)

    expect(fileHandle.writable.chunks).toHaveLength(1)
    const written = fileHandle.writable.chunks[0] as Blob
    expect(new Uint8Array(await written.arrayBuffer())).toEqual(data)
  })
})

describe('readDatabaseFromFileHandle', () => {
  it('FileSystemFileHandleの中身をUint8Arrayとして読み出す', async () => {
    const data = new Uint8Array([10, 11, 12])
    const fileHandle = createRecordingFileHandle(data)

    const result = await readDatabaseFromFileHandle(fileHandle)

    expect(result).toEqual(data)
  })
})
