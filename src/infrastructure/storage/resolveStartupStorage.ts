import type { StorageConfig } from './storageConfig'

export type StartupStorage =
  | { kind: 'ready' }
  | { kind: 'needs-reconnect'; folderName: string | null; handle: FileSystemDirectoryHandle | null }

export interface ResolveStartupStorageDeps {
  loadConfig(): Promise<StorageConfig>
  loadFolderHandle(): Promise<FileSystemDirectoryHandle | null>
}

/**
 * 起動時、Workerを作る前に、保存先がそのまま開けるかをメインスレッドで判定する(計画Issue #174)。
 * フォルダの権限はブラウザの再起動で「確認が必要」に戻ることがあり、再要求(requestPermission)には
 * ユーザーのクリックが要る。ここでは要求せず、開けないときは再接続画面へ進ませる。
 */
export async function resolveStartupStorage(deps: ResolveStartupStorageDeps): Promise<StartupStorage> {
  if ((await deps.loadConfig()).kind === 'indexeddb') return { kind: 'ready' }

  const handle = await deps.loadFolderHandle()
  if (!handle) return { kind: 'needs-reconnect', folderName: null, handle: null }

  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return { kind: 'ready' }
  return { kind: 'needs-reconnect', folderName: handle.name, handle }
}
