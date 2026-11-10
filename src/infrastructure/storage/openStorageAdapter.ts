import { FolderNotConnectedError } from './FolderNotConnectedError'
import type { StorageAdapter } from './StorageAdapter'
import type { StorageConfig } from './storageConfig'

export interface OpenStorageAdapterDeps {
  loadConfig(): Promise<StorageConfig>
  loadFolderHandle(): Promise<FileSystemDirectoryHandle | null>
  createIndexedDbAdapter(): StorageAdapter
  createFolderAdapter(folder: FileSystemDirectoryHandle): StorageAdapter
}

export interface OpenedStorageAdapter {
  kind: StorageConfig['kind']
  adapter: StorageAdapter
  /** フォルダ保存のときのフォルダ名。ブラウザ内ならnull */
  folderName: string | null
}

/**
 * Worker起動時に、保存された保存先の選択に応じたStorageAdapterを用意する(計画Issue #174)。
 * フォルダのハンドルはメインスレッドで権限確認済みのものを使うため、ここでは
 * queryPermissionで「granted」であることだけ確かめ、そうでなければDBを開かずに止める。
 */
export async function openStorageAdapter(deps: OpenStorageAdapterDeps): Promise<OpenedStorageAdapter> {
  const config = await deps.loadConfig()
  if (config.kind === 'indexeddb') {
    return { kind: 'indexeddb', adapter: deps.createIndexedDbAdapter(), folderName: null }
  }

  const folder = await deps.loadFolderHandle()
  if (!folder || (await folder.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new FolderNotConnectedError()
  }
  return { kind: 'folder', adapter: deps.createFolderAdapter(folder), folderName: folder.name }
}
