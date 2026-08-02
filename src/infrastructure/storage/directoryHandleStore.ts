const DATABASE_NAME = 'local-budget-file-system-access'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'directory-handle'
const RECORD_KEY = 'handle'

/**
 * ユーザーが選択したFileSystemDirectoryHandleをIndexedDBへ永続化するヘルパー
 * (docs/architecture.md 4.2節、計画Issue #57 目標1)。FileSystemDirectoryHandleは
 * structured cloneに対応しているため、IndexedDBStorageAdapterと同様の単一レコード
 * 保存パターンでハンドルオブジェクトをそのまま保存できる。IndexedDBはNode/jsdom環境に
 * 実装がなく再現できないため、動作検証はPlaywright(実ブラウザ)で行う
 * (docs/architecture.md 10章、e2e/file-system-access-storage-adapter.spec.ts)。
 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite')
      transaction.objectStore(OBJECT_STORE_NAME).put(handle, RECORD_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error as Error)
    })
  } finally {
    db.close()
  }
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDatabase()
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const request = db.transaction(OBJECT_STORE_NAME, 'readonly').objectStore(OBJECT_STORE_NAME).get(RECORD_KEY)
      request.onsuccess = () =>
        resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error as Error)
    })
  } finally {
    db.close()
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OBJECT_STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
}
