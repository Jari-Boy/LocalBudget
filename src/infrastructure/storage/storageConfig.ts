import { createIndexedDbSingleRecordStore } from './indexedDbSingleRecordStore'

/**
 * データの保存先の選択(計画Issue #174、docs/architecture.md 4.2節)。フォルダを選んだ場合の
 * ディレクトリハンドルは別途directoryHandleStoreに置く。
 */
export type StorageConfig = { kind: 'indexeddb' } | { kind: 'folder' }

const DEFAULT_CONFIG: StorageConfig = { kind: 'indexeddb' }

/** 保存されていた値を読み戻す。未保存・壊れた値は既定のブラウザ内(indexeddb)にそろえる。 */
export function parseStorageConfig(value: unknown): StorageConfig {
  if (typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'folder') {
    return { kind: 'folder' }
  }
  return DEFAULT_CONFIG
}

const store = createIndexedDbSingleRecordStore<StorageConfig>('local-budget-storage-config', 1, 'config', 'config')

/**
 * 保存先の選択をIndexedDBに永続化する。メインスレッド(起動時の再接続判定)とWorker(起動時の
 * アダプタ選択・保存先の切り替え)の両方から読み書きするため、IndexedDBに置く。
 * IndexedDBはNode/jsdomに実装がなく、動作検証はPlaywrightで行う(e2e/folder-storage.spec.ts)。
 */
export async function loadStorageConfig(): Promise<StorageConfig> {
  return parseStorageConfig(await store.get())
}

export async function saveStorageConfig(config: StorageConfig): Promise<void> {
  return store.put(config)
}
