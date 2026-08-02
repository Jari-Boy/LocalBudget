/**
 * File System Access API非対応環境(Firefox/Safari等)でFileSystemAccessStorageAdapter
 * の使用を試みた場合にスローされるエラー(docs/architecture.md 4.2節、計画Issue #57)。
 * IndexedDBへの自動フォールバックは行わず、このエラーと`isFileSystemAccessSupported()`
 * をUI側(別Issue)に提供することで、UI側が非対応環境向けの警告表示や選択肢の
 * 出し分けを実装できるようにする。
 */
export class FileSystemAccessNotSupportedError extends Error {
  constructor() {
    super('this browser does not support the File System Access API (showDirectoryPicker)')
    this.name = 'FileSystemAccessNotSupportedError'
  }
}
