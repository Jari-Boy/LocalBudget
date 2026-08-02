import { createIndexedDbSingleRecordStore } from './indexedDbSingleRecordStore'

const DATABASE_NAME = 'local-budget-file-system-access'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'directory-handle'
const RECORD_KEY = 'handle'

const store = createIndexedDbSingleRecordStore<FileSystemDirectoryHandle>(
  DATABASE_NAME,
  DATABASE_VERSION,
  OBJECT_STORE_NAME,
  RECORD_KEY,
)

/**
 * ユーザーが選択したFileSystemDirectoryHandleをIndexedDBへ永続化するヘルパー
 * (docs/architecture.md 4.2節、計画Issue #57 目標1)。FileSystemDirectoryHandleは
 * structured cloneに対応しているため、IndexedDBStorageAdapterと同じ
 * indexedDbSingleRecordStoreのパターンでハンドルオブジェクトをそのまま保存できる。
 * IndexedDBはNode/jsdom環境に実装がなく再現できないため、動作検証はPlaywright
 * (実ブラウザ)で行う(docs/architecture.md 10章、e2e/file-system-access-storage-adapter.spec.ts)。
 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return store.put(handle)
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return store.get()
}
