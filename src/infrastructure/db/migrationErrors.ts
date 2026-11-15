/**
 * マイグレーションの失敗を表すエラー(計画Issue #42)。起動時に画面側(メインスレッド)で
 * 原因を出し分けられるよう、種類ごとに別の型にする。
 */

/** DBの user_version が、このアプリの最新より大きい(新しいバージョンのアプリで保存された)。開かずに止める。 */
export class SchemaTooNewError extends Error {
  readonly databaseVersion: number
  readonly latestVersion: number

  constructor(databaseVersion: number, latestVersion: number) {
    super(`database schema version ${databaseVersion} is newer than the supported version ${latestVersion}`)
    this.name = 'SchemaTooNewError'
    this.databaseVersion = databaseVersion
    this.latestVersion = latestVersion
  }
}

/** 差分の適用に失敗した。DBは巻き戻され、元の状態のまま。 */
export class MigrationFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MigrationFailedError'
  }
}
