import { fromDatabaseFile, writeDatabaseToFileHandle } from './databaseFileCodec'
import { loadDirectoryHandle, saveDirectoryHandle } from './directoryHandleStore'
import { ensureReadWritePermission } from './ensureReadWritePermission'
import { ExternalChangeError } from './ExternalChangeError'
import { FileSystemAccessNotSupportedError } from './FileSystemAccessNotSupportedError'
import { isFileSystemAccessSupported } from './isFileSystemAccessSupported'
import type { StorageAdapter } from './StorageAdapter'

const DEFAULT_FILE_NAME = 'local-budget.sqlite'

/** ファイルの更新日時とサイズ。外部変更の検知に使う(計画Issue #175)。 */
interface FileStamp {
  lastModified: number
  size: number
}

/** 読み込み時・保存時にファイルが存在しなかったことの印 */
const ABSENT = 'absent'

function stampOf(file: File): FileStamp {
  return { lastModified: file.lastModified, size: file.size }
}

function isSameState(a: FileStamp | typeof ABSENT, b: FileStamp | typeof ABSENT): boolean {
  if (a === ABSENT || b === ABSENT) return a === b
  return a.lastModified === b.lastModified && a.size === b.size
}

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
  /** 最後に読み込み・保存したときのファイルの状態。nullは未確認(外部変更の検査をしない) */
  private knownState: FileStamp | typeof ABSENT | null = null

  /**
   * `directoryHandle`は、メインスレッドで選択・権限確認済みのハンドルを受け取るときに渡す
   * (計画Issue #174)。Worker内には`window`が無くコンストラクタの対応判定
   * (`showDirectoryPicker`の有無)が使えないため、ハンドルがあれば判定を通さない。
   * ハンドルがあること自体が、対応環境の証拠になる。
   */
  constructor(fileName: string = DEFAULT_FILE_NAME, directoryHandle: FileSystemDirectoryHandle | null = null) {
    if (directoryHandle === null && !isFileSystemAccessSupported()) {
      throw new FileSystemAccessNotSupportedError()
    }
    this.fileName = fileName
    this.directoryHandle = directoryHandle
  }

  static fromDirectoryHandle(
    directoryHandle: FileSystemDirectoryHandle,
    fileName: string = DEFAULT_FILE_NAME,
  ): FileSystemAccessStorageAdapter {
    return new FileSystemAccessStorageAdapter(fileName, directoryHandle)
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
    if (!fileHandle) {
      this.knownState = ABSENT
      return null
    }

    // 内容と更新日時は同じ瞬間のものを記録する(読み込み中に変わっても、記録は読んだ内容のもの)
    const file = await fileHandle.getFile()
    this.knownState = stampOf(file)
    return fromDatabaseFile(file)
  }

  /**
   * 保存の直前にファイルの更新日時とサイズを、最後に読み込み・保存したときの記録と照らし、
   * 外部で変わっていればExternalChangeErrorで止める(計画Issue #175)。同期クライアントが日時を
   * 保ったまま置換する場合に備えてサイズも見る。読み込み・保存を一度もしていない(記録がない)ときは、
   * 保存先の切り替えでの意図した上書きなので検査しない。検知から書き込み完了までの短い隙間の競合は残る。
   */
  async save(data: Uint8Array): Promise<void> {
    const directoryHandle = this.requireDirectoryHandle()
    if (this.knownState !== null) {
      const existing = await this.getExistingFileHandle(directoryHandle)
      const current = existing ? stampOf(await existing.getFile()) : ABSENT
      if (!isSameState(this.knownState, current)) throw new ExternalChangeError()
    }

    const fileHandle = await directoryHandle.getFileHandle(this.fileName, { create: true })
    await writeDatabaseToFileHandle(fileHandle, data)
    // 自分の書き込みによる更新日時の変化を、次の保存で外部変更と誤検知しないよう記録し直す
    this.knownState = stampOf(await fileHandle.getFile())
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
