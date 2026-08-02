import { createIndexedDbSingleRecordStore } from './indexedDbSingleRecordStore'
import type { StorageAdapter } from './StorageAdapter'

const DATABASE_NAME = 'local-budget'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'sqlite-snapshot'
const RECORD_KEY = 'snapshot'

const store = createIndexedDbSingleRecordStore<Uint8Array>(
  DATABASE_NAME,
  DATABASE_VERSION,
  OBJECT_STORE_NAME,
  RECORD_KEY,
)

/**
 * StorageAdapterのIndexedDB実装(docs/architecture.md 4.2節)。全ブラウザ対応の
 * 既定の保存先で、DB全体をシリアライズしたバイト列を単一レコードとして保存する。
 * IndexedDBはNode/jsdom環境に実装がなくVitestで再現できないため、動作検証は
 * Playwright(実ブラウザ)で行う(docs/architecture.md 10章、e2e/indexed-db-storage-adapter.spec.ts)。
 */
export class IndexedDBStorageAdapter implements StorageAdapter {
  async load(): Promise<Uint8Array | null> {
    return store.get()
  }

  async save(data: Uint8Array): Promise<void> {
    return store.put(data)
  }
}
