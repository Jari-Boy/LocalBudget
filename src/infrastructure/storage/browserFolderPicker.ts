import { describeFolderDatabase, type FolderDatabaseInfo } from './describeFolderDatabase'
import { isFileSystemAccessSupported } from './isFileSystemAccessSupported'

/** フォルダ選択(メインスレッドでしかできない)。設定画面の保存先欄が使う。 */
export interface FolderPicker {
  isSupported: boolean
  /** ユーザーにフォルダを選ばせる。キャンセルされたらnull */
  pick(): Promise<FileSystemDirectoryHandle | null>
  /** 選んだフォルダの既存DBファイルの情報。無ければnull */
  describe(folder: FileSystemDirectoryHandle): Promise<FolderDatabaseInfo | null>
}

interface BrowserFolderPickerDeps {
  showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  isSupported: () => boolean
}

/**
 * 設定画面のフォルダ選択の本番実装(計画Issue #174)。showDirectoryPickerはユーザー操作の中で
 * メインスレッドからだけ呼べる。ユーザーがダイアログを閉じたとき(AbortError)はエラーにせずnullを返す。
 * 引数は、Nodeに無いブラウザAPIをテストで差し替えるためのもの。
 */
export function createBrowserFolderPicker(deps: BrowserFolderPickerDeps): FolderPicker {
  return {
    get isSupported() {
      return deps.isSupported()
    },
    async pick() {
      try {
        return await deps.showDirectoryPicker({ mode: 'readwrite' })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null
        throw error
      }
    },
    describe: describeFolderDatabase,
  }
}

/** 本番(ブラウザ)で使うフォルダ選択。 */
export const browserFolderPicker = createBrowserFolderPicker({
  showDirectoryPicker: (options) => window.showDirectoryPicker(options),
  isSupported: isFileSystemAccessSupported,
})
