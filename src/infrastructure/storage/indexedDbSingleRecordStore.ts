/**
 * IndexedDBの単一object store・単一固定キーに1レコードを保存/取得する汎用ヘルパー。
 * IndexedDBStorageAdapter(DBバイト列の保存)とdirectoryHandleStore
 * (FileSystemDirectoryHandleの保存)の両方が「DB open + get + put」という同一パターンを
 * 個別実装していたため、DB名/バージョン/ストア名/キー名のみ差し替えられる形に共通化した
 * (計画Issue #57 evaluatorレビュー Attempt 1の指摘)。
 */
export interface IndexedDbSingleRecordStore<T> {
  get(): Promise<T | null>
  put(value: T): Promise<void>
}

export function createIndexedDbSingleRecordStore<T>(
  databaseName: string,
  databaseVersion: number,
  objectStoreName: string,
  recordKey: string,
): IndexedDbSingleRecordStore<T> {
  function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(objectStoreName)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error as Error)
    })
  }

  return {
    async get(): Promise<T | null> {
      const db = await openDatabase()
      try {
        return await new Promise<T | null>((resolve, reject) => {
          const request = db.transaction(objectStoreName, 'readonly').objectStore(objectStoreName).get(recordKey)
          request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
          request.onerror = () => reject(request.error as Error)
        })
      } finally {
        db.close()
      }
    },

    async put(value: T): Promise<void> {
      const db = await openDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(objectStoreName, 'readwrite')
          transaction.objectStore(objectStoreName).put(value, recordKey)
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error as Error)
        })
      } finally {
        db.close()
      }
    },
  }
}
