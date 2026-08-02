import { readDatabaseFromFileHandle, writeDatabaseToFileHandle } from './databaseFileCodec'
import { loadDirectoryHandle, saveDirectoryHandle } from './directoryHandleStore'
import { ensureReadWritePermission } from './ensureReadWritePermission'
import { FileSystemAccessNotSupportedError } from './FileSystemAccessNotSupportedError'
import { isFileSystemAccessSupported } from './isFileSystemAccessSupported'
import type { StorageAdapter } from './StorageAdapter'

const DEFAULT_FILE_NAME = 'local-budget.sqlite'

/**
 * StorageAdapterのFile System Access API実装(docs/architecture.md 4.2節)。ユーザーが
 * `showDirectoryPicker`で選択したローカルフォルダ、またはクラウド同期クライアントが
 * 作るローカルフォルダへDBファイルを書き込む。Chromium系のみ対応であり、非対応環境
 * (Firefox/Safari)ではコンストラクタが`FileSystemAccessNotSupportedError`をスローする
 * (IndexedDBへの自動フォールバックは行わない、計画Issue #57)。
 *
 * `showDirectoryPicker`はユーザージェスチャーを要求しWindowでのみ呼び出せるため、
 * ディレクトリの選択(`selectNewDirectory`)・復元(`restoreDirectory`)は`load`/`save`
 * とは独立した明示的な操作として提供する。呼び出しタイミング(初回起動時の選択・
 * 起動時の復元)はUI側(別Issue)の責務とする。
 *
 * IndexedDBはNode/jsdom環境に実装がなく再現できないため、動作検証はPlaywright
 * (実ブラウザ)で行う(docs/architecture.md 10章、e2e/file-system-access-storage-adapter.spec.ts)。
 */
export class FileSystemAccessStorageAdapter implements StorageAdapter {
  private directoryHandle: FileSystemDirectoryHandle | null = null
  private readonly fileName: string

  constructor(fileName: string = DEFAULT_FILE_NAME) {
    if (!isFileSystemAccessSupported()) {
      throw new FileSystemAccessNotSupportedError()
    }
    this.fileName = fileName
  }

  /** showDirectoryPickerでユーザーにディレクトリを選択させ、ハンドルをIndexedDBに保存する。 */
  async selectNewDirectory(): Promise<void> {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await saveDirectoryHandle(handle)
    this.directoryHandle = handle
  }

  /**
   * 前回選択済みのディレクトリハンドルをIndexedDBから復元し、readwrite権限を再確認する。
   * ハンドルが保存されていない場合、または権限が得られなかった場合はfalseを返す。
   */
  async restoreDirectory(): Promise<boolean> {
    const handle = await loadDirectoryHandle()
    if (!handle) return false

    if (!(await ensureReadWritePermission(handle))) return false

    this.directoryHandle = handle
    return true
  }

  async load(): Promise<Uint8Array | null> {
    const directoryHandle = this.requireDirectoryHandle()
    const fileHandle = await this.getExistingFileHandle(directoryHandle)
    if (!fileHandle) return null

    return readDatabaseFromFileHandle(fileHandle)
  }

  async save(data: Uint8Array): Promise<void> {
    const directoryHandle = this.requireDirectoryHandle()
    const fileHandle = await directoryHandle.getFileHandle(this.fileName, { create: true })
    await writeDatabaseToFileHandle(fileHandle, data)
  }

  private requireDirectoryHandle(): FileSystemDirectoryHandle {
    if (!this.directoryHandle) {
      throw new Error(
        'directory has not been selected; call selectNewDirectory() or restoreDirectory() first',
      )
    }
    return this.directoryHandle
  }

  private async getExistingFileHandle(
    directoryHandle: FileSystemDirectoryHandle,
  ): Promise<FileSystemFileHandle | null> {
    try {
      return await directoryHandle.getFileHandle(this.fileName)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null
      throw error
    }
  }
}
