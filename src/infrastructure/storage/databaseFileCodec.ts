/**
 * DBバイト列(sql.jsのUint8Array)とファイルI/O(Blob/File/FileSystemFileHandle)間の
 * 変換ロジック(docs/architecture.md 8章)。FileSystemAccessStorageAdapterと将来の
 * Export/Import機能(#26、Blobダウンロード・ファイル選択によるアップロード)の双方で
 * 同じ変換ロジックを再利用できるよう、File System Access API固有の書き込み/読み込み
 * (writeDatabaseToFileHandle/readDatabaseFromFileHandle)と、汎用的なBlob/File変換
 * (toDatabaseBlob/fromDatabaseFile)を分離して切り出す。
 */
export function toDatabaseBlob(data: Uint8Array): Blob {
  // sql.jsの型定義(db.export(): Uint8Array)はUint8Array<ArrayBufferLike>(SharedArrayBuffer
  // を許容する形)を指すため、ArrayBuffer限定のBlobPartとは型上厳密には一致しない。
  // sql.js自体がSharedArrayBufferを扱うことはなく実行時には常にArrayBufferなので、
  // ここでのみ型を合わせる。
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
}

export async function fromDatabaseFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

export async function writeDatabaseToFileHandle(
  fileHandle: FileSystemFileHandle,
  data: Uint8Array,
): Promise<void> {
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(toDatabaseBlob(data))
  } finally {
    await writable.close()
  }
}

export async function readDatabaseFromFileHandle(
  fileHandle: FileSystemFileHandle,
): Promise<Uint8Array> {
  const file = await fileHandle.getFile()
  return fromDatabaseFile(file)
}
