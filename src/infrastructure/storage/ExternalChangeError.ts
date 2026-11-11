/**
 * 保存先のファイルが、このアプリが最後に読み込み・保存した後に外部(別の端末の同期クライアント等)で
 * 変わっていたため、上書きせずに保存を止めたときのエラー(計画Issue #175)。データの自動マージはせず、
 * 利用者に判断させる。withAutoSaveが捕まえて保存を止め、画面の警告に伝える。
 */
export class ExternalChangeError extends Error {
  constructor() {
    super('the storage file was changed externally since it was last loaded or saved; refusing to overwrite it')
    this.name = 'ExternalChangeError'
  }
}
