/**
 * 保存先がフォルダなのに、フォルダのハンドルが無い、またはreadwrite権限が得られていない場合に
 * 投げるエラー(計画Issue #174)。DBを開かずに起動を止める。権限の再要求はユーザー操作を要し
 * Workerからはできないため、メインスレッドの再接続画面で解決する。
 */
export class FolderNotConnectedError extends Error {
  constructor() {
    super('the storage folder is not connected; reconnect the folder before opening the database')
    this.name = 'FolderNotConnectedError'
  }
}
