import type { Database } from 'sql.js'
import { assertImportableDatabase } from '../backup/assertImportableDatabase'
import { InvalidBackupFileError } from '../backup/InvalidBackupFileError'
import { ReadOnlyStorageError } from '../storage/ReadOnlyStorageError'
import type { StorageAdapter } from '../storage/StorageAdapter'
import type { StorageConfig } from '../storage/storageConfig'
import type { AutoSaveController } from '../storage/withAutoSave'

/** 起動時に決まった、今のタブの保存先の状態(設定画面の表示と読み取り専用の警告に使う)。 */
export interface StorageStatus {
  kind: StorageConfig['kind']
  /** フォルダ保存のときのフォルダ名。ブラウザ内ならnull */
  folderName: string | null
  /** falseなら別のタブが書き込みの権利を持っており、このタブの変更は保存されない */
  writable: boolean
  /**
   * 保存先のファイルが外部(別の端末の同期等)で更新されたため、保存を止めている(計画Issue #175)。
   * 起動後に変わりうるので、getStatus()が呼ばれるたびに自動保存の状態から取り直す。
   */
  externalChange: boolean
}

/**
 * 保存先の切り替えのRPC API(計画Issue #174)。成功後のページ再読み込みは呼び出し元
 * (メインスレッド)の責務で、再読み込みで起動し直したWorkerが新しい保存先から読み直す
 * (バックアップの読み込み、計画Issue #26・#173と同じ方式)。
 */
export interface StorageRpcApi {
  getStatus(): StorageStatus
  /**
   * 保存先をフォルダにする。copyは今のデータをフォルダのDBファイルへ書き込み(既存ファイルは置き換わる)、
   * openはフォルダにあるDBファイルを検証して、そのまま使う(書き込まない)。
   */
  moveToFolder(folder: FileSystemDirectoryHandle, mode: 'copy' | 'open'): Promise<void>
  /**
   * 保存先をブラウザ保存に戻す。copyは今のデータをブラウザ内へ書き込み、keepはブラウザ内に残っている
   * (フォルダに切り替えた時点の)データをそのまま使う。どちらもフォルダのファイルは消さない。
   */
  moveToIndexedDb(mode: 'copy' | 'keep'): Promise<void>
}

export interface StorageApiDeps {
  db: Database
  autoSave: AutoSaveController
  status: Omit<StorageStatus, 'externalChange'>
  createFolderAdapter(folder: FileSystemDirectoryHandle): StorageAdapter
  indexedDbAdapter: StorageAdapter
  saveFolderHandle(folder: FileSystemDirectoryHandle): Promise<void>
  saveConfig(config: StorageConfig): Promise<void>
}

/**
 * 保存先の切り替えは、(1)検証など失敗しうる確認、(2)自動保存の保留分のflushと停止、(3)新しい
 * 保存先へのデータの書き込み、(4)ハンドルと保存先の選択の永続化、の順に行う。(4)を最後にするのは、
 * (3)までが失敗したときに保存先の選択を変えず、次の起動で元の保存先から開けるようにするため。
 * (2)でstop()するのは、再読み込み時のpagehideで古いDBが書き戻されないようにするため
 * (importDatabaseBackupと同じ理由)。
 */
export function createStorageApi(deps: StorageApiDeps): StorageRpcApi {
  const { db, autoSave, status } = deps

  function assertWritable(): void {
    if (!status.writable) throw new ReadOnlyStorageError()
  }

  async function settleAutoSave(): Promise<void> {
    await autoSave.flush()
    await autoSave.stop()
  }

  /**
   * 自動保存を止めた後の手順(新しい保存先への書き込み、ハンドルと保存先の選択の保存)を実行する。
   * 失敗したらページは再読み込みされず、元の保存先のまま編集が続くため、止めた自動保存を再開する。
   * 成功したときは再開しない(再読み込みで新しい保存先から起動し直す)。
   */
  async function afterSettling(steps: () => Promise<void>): Promise<void> {
    try {
      await steps()
    } catch (error) {
      autoSave.resume()
      throw error
    }
  }

  return {
    getStatus: () => ({ ...status, externalChange: autoSave.hasExternalChange() }),

    async moveToFolder(folder, mode) {
      assertWritable()
      const folderAdapter = deps.createFolderAdapter(folder)

      if (mode === 'open') {
        const data = await folderAdapter.load()
        if (data === null) throw new InvalidBackupFileError('the folder has no database file')
        await assertImportableDatabase(data)
      }

      await settleAutoSave()
      await afterSettling(async () => {
        if (mode === 'copy') await folderAdapter.save(db.export())
        await deps.saveFolderHandle(folder)
        await deps.saveConfig({ kind: 'folder' })
      })
    },

    async moveToIndexedDb(mode) {
      assertWritable()
      await settleAutoSave()
      await afterSettling(async () => {
        if (mode === 'copy') await deps.indexedDbAdapter.save(db.export())
        await deps.saveConfig({ kind: 'indexeddb' })
      })
    },
  }
}
