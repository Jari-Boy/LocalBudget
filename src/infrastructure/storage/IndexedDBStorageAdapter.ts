import type { StorageAdapter } from './StorageAdapter'

const DATABASE_NAME = 'local-budget'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'sqlite-snapshot'
const RECORD_KEY = 'snapshot'

/**
 * StorageAdapterのIndexedDB実装(docs/architecture.md 4.2節)。全ブラウザ対応の
 * 既定の保存先で、DB全体をシリアライズしたバイト列を単一レコードとして保存する。
 * IndexedDBはNode/jsdom環境に実装がなくVitestで再現できないため、動作検証は
 * Playwright(実ブラウザ)で行う(docs/architecture.md 10章、e2e/indexed-db-storage-adapter.spec.ts)。
 */
export class IndexedDBStorageAdapter implements StorageAdapter {
  async load(): Promise<Uint8Array | null> {
    const db = await openDatabase()
    try {
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const request = db.transaction(OBJECT_STORE_NAME, 'readonly').objectStore(OBJECT_STORE_NAME).get(RECORD_KEY)
        request.onsuccess = () => resolve((request.result as Uint8Array | undefined) ?? null)
        request.onerror = () => reject(request.error as Error)
      })
    } finally {
      db.close()
    }
  }

  async save(data: Uint8Array): Promise<void> {
    const db = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite')
        transaction.objectStore(OBJECT_STORE_NAME).put(data, RECORD_KEY)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error as Error)
      })
    } finally {
      db.close()
    }
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
